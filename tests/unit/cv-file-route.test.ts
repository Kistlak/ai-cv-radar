import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const state = vi.hoisted(() => ({
  signedIn: true,
  result: null as unknown,
  calls: [] as unknown[][],
}))

vi.mock('@/lib/auth', () => ({
  requireUser: async () =>
    state.signedIn
      ? { user: { id: 'u1' }, supabase: { fake: true } }
      : { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) },
}))
vi.mock('@/lib/cv-retention', () => ({
  getCvFile: async (...args: unknown[]) => {
    state.calls.push(args)
    return state.result
  },
}))

import { GET } from '@/app/api/cv/[id]/file/route'

const CV_ID = '7d1f2c4e-8a3b-4c5d-9e6f-0a1b2c3d4e5f'
const get = (id: string) =>
  GET(new NextRequest(`http://localhost/api/cv/${id}/file`), { params: Promise.resolve({ id }) })

beforeEach(() => {
  state.signedIn = true
  state.result = null
  state.calls = []
})

describe('GET /api/cv/[id]/file', () => {
  it('returns the PDF inline, uncached, named by upload date', async () => {
    state.result = { ok: true, bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), createdAt: new Date('2026-10-21T08:00:00Z') }
    const res = await get(CV_ID)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="CV-2026-10-21.pdf"')
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]))
    expect(state.calls).toEqual([['u1', CV_ID, { fake: true }]])
  })

  it('returns 401 when signed out, without looking anything up', async () => {
    state.signedIn = false
    expect((await get(CV_ID)).status).toBe(401)
    expect(state.calls).toEqual([])
  })

  it('returns 404 for an id that is not a uuid, without looking anything up', async () => {
    expect((await get('not-a-uuid')).status).toBe(404)
    expect(state.calls).toEqual([])
  })

  it("returns 404 for a CV that isn't the user's", async () => {
    state.result = { ok: false, reason: 'not_found' }
    const res = await get(CV_ID)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'CV not found' })
  })

  it('returns 500 with a readable message when storage fails', async () => {
    state.result = { ok: false, reason: 'storage_failed' }
    const res = await get(CV_ID)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Could not load the CV file. Please try again.' })
  })
})
