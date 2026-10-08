import { after } from 'next/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { searches } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getDecryptedKeys } from '@/app/api/keys/route'
import { resolveProvider } from '@/lib/ai/provider'
import { runSearch } from '@/lib/run-search'
import { failStaleSearches, isStale } from '@/lib/stale-searches'
import {
  consumeQuota,
  hasTooManyRunningSearches,
  quotaExceededResponse,
  searchUsesFallback,
  tooManyRunningSearchesResponse,
} from '@/lib/usage-limits'
import { z } from 'zod'
import crypto from 'crypto'
import { requireUser } from '@/lib/auth'
import { getActiveCv } from '@/lib/cv'

// The response returns in ~1s, but the after() background pipeline (derive →
// fetch/agentic → score → persist) runs inside this function's duration budget.
// Without this, Vercel kills the worker at the default limit mid-run and the
// search is stranded in 'running' with no error. 300s is the Hobby-plan ceiling
// (requires Fluid Compute, the default for new projects).
export const maxDuration = 300

const SearchSchema = z.object({
  query: z.string().max(200).optional().default(''),
  location: z.string().max(100).optional(),
  remoteOnly: z.boolean().optional().default(false),
  sources: z.array(z.string()).optional().default(['remotive', 'adzuna', 'jsearch', 'linkedin', 'indeed', 'glassdoor']),
  maxResults: z.number().int().min(1).max(50).nullable().optional(),
})

export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (auth.response) return auth.response
  const { user } = auth

  const body = await req.json().catch(() => null)
  const parsed = SearchSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { query, location, remoteOnly, sources, maxResults } = parsed.data

  // Verify user has a CV; the search is pinned to the active (newest) one
  const cv = await getActiveCv(user.id)
  if (!cv) return NextResponse.json({ error: 'Upload a CV before searching' }, { status: 400 })

  // Verify the user can run AI calls with either provider (their own key or an
  // operator FALLBACK_* env key). The agentic Apify path additionally needs an
  // Anthropic key — run-search checks that per-search and falls back gracefully.
  const keys = await getDecryptedKeys(user.id)
  const resolved = resolveProvider(keys.preferredAiProvider, keys)
  if (!resolved)
    return NextResponse.json(
      { error: 'Add an Anthropic or Gemini API key in Settings' },
      { status: 400 }
    )

  if (await hasTooManyRunningSearches(user.id)) return tooManyRunningSearchesResponse()

  if (searchUsesFallback(keys.usingFallback, resolved.provider, sources)) {
    const quota = await consumeQuota(user.id, 'search')
    if (!quota.ok) return quotaExceededResponse(quota)
  }

  // Stable hash of the sources array so the schema constraint is satisfied
  const sourcesHash = crypto
    .createHash('sha256')
    .update(sources.sort().join(','))
    .digest('hex')
    .slice(0, 16)

  // Create the search record immediately (status: running)
  const [search] = await db
    .insert(searches)
    .values({
      userId: user.id,
      cvId: cv.id,
      query,
      location: location ?? null,
      remoteOnly: remoteOnly ?? false,
      sources,
      sourcesHash,
      maxResults: maxResults ?? null,
      status: 'running',
    })
    .returning()

  // Fire background processing after the response is sent
  after(async () => {
    await runSearch(search.id, user.id)
  })

  return NextResponse.json({ searchId: search.id }, { status: 202 })
}

export async function GET(req: NextRequest) {
  const auth = await requireUser()
  if (auth.response) return auth.response
  const { user } = auth

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const [search] = await db
    .select()
    .from(searches)
    .where(eq(searches.id, id))
    .limit(1)

  if (!search || search.userId !== user.id)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // This is polled every 2s, so only write when the search looks stranded.
  if (search.status === 'running' && isStale(search.createdAt)) {
    await failStaleSearches(user.id)
    const [updated] = await db
      .select()
      .from(searches)
      .where(eq(searches.id, id))
      .limit(1)
    return NextResponse.json({ search: updated ?? search })
  }

  return NextResponse.json({ search })
}
