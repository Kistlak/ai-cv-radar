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

export async function getDecryptedKeys(userId: string) {
  const [keys] = await db
    .select()
    .from(userApiKeys)
    .where(eq(userApiKeys.userId, userId))
    .limit(1)

  if (!keys) return null

  return {
    anthropicKey: keys.anthropicKey ? decrypt(keys.anthropicKey) : undefined,
    apifyToken: keys.apifyToken ? decrypt(keys.apifyToken) : undefined,
    adzunaAppId: keys.adzunaAppId ?? undefined,
    adzunaAppKey: keys.adzunaAppKey ? decrypt(keys.adzunaAppKey) : undefined,
    rapidapiKey: keys.rapidapiKey ? decrypt(keys.rapidapiKey) : undefined,
  }
}
