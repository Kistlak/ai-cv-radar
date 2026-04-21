import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { userApiKeys } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { encrypt, decrypt } from '@/lib/crypto'
import { z } from 'zod'

const SaveKeysSchema = z.object({
  anthropic_key: z.string().min(1).optional(),
  apify_token: z.string().min(1).optional(),
  adzuna_app_id: z.string().min(1).optional(),
  adzuna_app_key: z.string().min(1).optional(),
  rapidapi_key: z.string().min(1).optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = SaveKeysSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { anthropic_key, apify_token, adzuna_app_id, adzuna_app_key, rapidapi_key } = parsed.data

  const updates: Partial<typeof userApiKeys.$inferInsert> = { userId: user.id }
  if (anthropic_key) updates.anthropicKey = encrypt(anthropic_key)
  if (apify_token) updates.apifyToken = encrypt(apify_token)
  if (adzuna_app_id) updates.adzunaAppId = adzuna_app_id
  if (adzuna_app_key) updates.adzunaAppKey = encrypt(adzuna_app_key)
  if (rapidapi_key) updates.rapidapiKey = encrypt(rapidapi_key)

  await db
    .insert(userApiKeys)
    .values({ userId: user.id, ...updates })
    .onConflictDoUpdate({ target: userApiKeys.userId, set: updates })

  return NextResponse.json({ success: true })
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [keys] = await db
    .select()
    .from(userApiKeys)
    .where(eq(userApiKeys.userId, user.id))
    .limit(1)

  return NextResponse.json({
    anthropic_key: Boolean(keys?.anthropicKey),
    apify_token: Boolean(keys?.apifyToken),
    adzuna_app_id: Boolean(keys?.adzunaAppId),
    adzuna_app_key: Boolean(keys?.adzunaAppKey),
    rapidapi_key: Boolean(keys?.rapidapiKey),
  })
}

export interface ResolvedKeys {
  anthropicKey?: string
  apifyToken?: string
  adzunaAppId?: string
  adzunaAppKey?: string
  rapidapiKey?: string
  // Per-key flag set when the value came from the operator-provided FALLBACK_*
  // env var instead of the user's own configured key. Useful for telemetry,
  // rate limiting, or showing a "shared key" badge in the UI.
  usingFallback: {
    anthropicKey: boolean
    apifyToken: boolean
    adzunaAppId: boolean
    adzunaAppKey: boolean
    rapidapiKey: boolean
  }
}

export async function getDecryptedKeys(userId: string): Promise<ResolvedKeys> {
  const [row] = await db
    .select()
    .from(userApiKeys)
    .where(eq(userApiKeys.userId, userId))
    .limit(1)

  const userAnthropic = row?.anthropicKey ? decrypt(row.anthropicKey) : undefined
  const userApify = row?.apifyToken ? decrypt(row.apifyToken) : undefined
  const userAdzunaId = row?.adzunaAppId ?? undefined
  const userAdzunaKey = row?.adzunaAppKey ? decrypt(row.adzunaAppKey) : undefined
  const userRapidapi = row?.rapidapiKey ? decrypt(row.rapidapiKey) : undefined

  const fallbackAnthropic = process.env.FALLBACK_ANTHROPIC_KEY || undefined
  const fallbackApify = process.env.FALLBACK_APIFY_TOKEN || undefined
  const fallbackAdzunaId = process.env.FALLBACK_ADZUNA_APP_ID || undefined
  const fallbackAdzunaKey = process.env.FALLBACK_ADZUNA_APP_KEY || undefined
  const fallbackRapidapi = process.env.FALLBACK_RAPIDAPI_KEY || undefined

  return {
    anthropicKey: userAnthropic ?? fallbackAnthropic,
    apifyToken: userApify ?? fallbackApify,
    adzunaAppId: userAdzunaId ?? fallbackAdzunaId,
    adzunaAppKey: userAdzunaKey ?? fallbackAdzunaKey,
    rapidapiKey: userRapidapi ?? fallbackRapidapi,
    usingFallback: {
      anthropicKey: !userAnthropic && !!fallbackAnthropic,
      apifyToken: !userApify && !!fallbackApify,
      adzunaAppId: !userAdzunaId && !!fallbackAdzunaId,
      adzunaAppKey: !userAdzunaKey && !!fallbackAdzunaKey,
      rapidapiKey: !userRapidapi && !!fallbackRapidapi,
    },
  }
}
