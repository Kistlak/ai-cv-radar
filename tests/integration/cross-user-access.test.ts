// Cross-user access: the app connects as `postgres`, so RLS never applies and
// app code is the only thing keeping users apart. These tests create two
// temporary users with a CV, search and job each, then check that user B gets
// 404 on everything that belongs to user A. Rows are removed in afterAll.
import crypto from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { inArray } from 'drizzle-orm'

const auth = vi.hoisted(() => ({ userId: null as string | null }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: auth.userId ? { id: auth.userId, email: `${auth.userId}@test.invalid` } : null },
      }),
    },
  }),
}))

import { db } from '@/db'
import { cvs, jobResults, profiles, searches } from '@/db/schema'
import { GET as getSearch } from '@/app/api/search/route'
import { POST as cancelSearch } from '@/app/api/search/[id]/cancel/route'
import { POST as deepDive } from '@/app/api/jobs/[id]/deep-dive/route'
import { POST as coverLetter } from '@/app/api/jobs/[id]/cover-letter/route'
import { POST as tailoredCv } from '@/app/api/jobs/[id]/tailored-cv/route'
import { GET as tailoredCvDownload } from '@/app/api/jobs/[id]/tailored-cv/download/route'
import { DELETE as deleteCvRoute } from '@/app/api/cv/[id]/route'

const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let cvA = ''
let searchA = ''
let jobA = ''

const req = (url: string, method = 'GET') => new NextRequest(`http://localhost${url}`, { method })
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeAll(async () => {
  await db.insert(profiles).values([
    { id: userA, email: 'xuser-a@test.invalid' },
    { id: userB, email: 'xuser-b@test.invalid' },
  ])
  const [cv] = await db
    .insert(cvs)
    .values({ userId: userA, filePath: `${userA}/test.pdf`, rawText: 'test cv', structured: {}, isActive: true })
    .returning({ id: cvs.id })
  const [search] = await db
    .insert(searches)
    .values({ userId: userA, cvId: cv.id, query: 'integration test', sources: ['remotive'], status: 'complete' })
    .returning({ id: searches.id })
  const [job] = await db
    .insert(jobResults)
    .values({
      searchId: search.id,
      source: 'remotive',
      sourceJobId: 'it-1',
      title: 'Test job',
      company: 'Test co',
      applyUrl: 'https://example.com/1',
      tailoredCv: { name: 'x' },
    })
    .returning({ id: jobResults.id })
  cvA = cv.id
  searchA = search.id
  jobA = job.id
})

afterAll(async () => {
  // Deleting the profiles cascades to cvs, searches and job_results.
  await db.delete(profiles).where(inArray(profiles.id, [userA, userB]))
})

describe('owner (positive control)', () => {
  it('user A can read their own search', async () => {
    auth.userId = userA
    const res = await getSearch(req(`/api/search?id=${searchA}`))
    expect(res.status).toBe(200)
  })
})

describe("user B cannot reach user A's data", () => {
  it('search GET → 404', async () => {
    auth.userId = userB
    expect((await getSearch(req(`/api/search?id=${searchA}`))).status).toBe(404)
  })

  it('search cancel → 404 (and the search is untouched)', async () => {
    auth.userId = userB
    expect((await cancelSearch(req(`/api/search/${searchA}/cancel`, 'POST'), params(searchA))).status).toBe(404)
    const [row] = await db.select({ status: searches.status }).from(searches).where(inArray(searches.id, [searchA]))
    expect(row.status).toBe('complete')
  })

  it('deep-dive → 404', async () => {
    auth.userId = userB
    expect((await deepDive(req(`/api/jobs/${jobA}/deep-dive`, 'POST'), params(jobA))).status).toBe(404)
  })

  it('cover letter → 404', async () => {
    auth.userId = userB
    expect((await coverLetter(req(`/api/jobs/${jobA}/cover-letter`, 'POST'), params(jobA))).status).toBe(404)
  })

  it('tailored CV → 404', async () => {
    auth.userId = userB
    expect((await tailoredCv(req(`/api/jobs/${jobA}/tailored-cv`, 'POST'), params(jobA))).status).toBe(404)
  })

  it('CV delete → 404 (and the CV is untouched)', async () => {
    auth.userId = userB
    expect((await deleteCvRoute(req(`/api/cv/${cvA}`, 'DELETE'), params(cvA))).status).toBe(404)
    const [row] = await db.select({ id: cvs.id }).from(cvs).where(inArray(cvs.id, [cvA]))
    expect(row?.id).toBe(cvA)
  })

  it('tailored CV download → 404', async () => {
    auth.userId = userB
    expect((await tailoredCvDownload(req(`/api/jobs/${jobA}/tailored-cv/download`), params(jobA))).status).toBe(404)
  })
})

describe('signed out', () => {
  it('search GET → 401', async () => {
    auth.userId = null
    expect((await getSearch(req(`/api/search?id=${searchA}`))).status).toBe(401)
  })
})
