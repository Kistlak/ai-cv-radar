import { after } from 'next/server'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { cvs, userApiKeys, searches } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { runSearch } from '@/lib/run-search'
import { z } from 'zod'
import crypto from 'crypto'

const SearchSchema = z.object({
  query: z.string().max(200).optional().default(''),
  location: z.string().max(100).optional(),
  remoteOnly: z.boolean().optional().default(false),
  sources: z.array(z.string()).optional().default(['remotive', 'adzuna', 'jsearch', 'linkedin', 'indeed', 'glassdoor']),
  maxResults: z.number().int().min(1).max(50).nullable().optional(),
})

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = SearchSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { query, location, remoteOnly, sources, maxResults } = parsed.data

  // Verify user has a CV
  const [cv] = await db.select({ id: cvs.id }).from(cvs).where(eq(cvs.userId, user.id)).limit(1)
  if (!cv) return NextResponse.json({ error: 'Upload a CV before searching' }, { status: 400 })

  // Verify user has an Anthropic key
  const [keys] = await db
    .select({ anthropicKey: userApiKeys.anthropicKey })
    .from(userApiKeys)
    .where(eq(userApiKeys.userId, user.id))
    .limit(1)
  if (!keys?.anthropicKey)
    return NextResponse.json({ error: 'Anthropic key required' }, { status: 400 })

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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  return NextResponse.json({ search })
}
