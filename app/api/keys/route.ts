import { NextResponse } from 'next/server'
import { db } from '@/db'
import { userApiKeys } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { encrypt } from '@/lib/crypto'
import type { AiProvider } from '@/lib/ai/provider'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { nextPreferredProvider, type DeletableKeyField } from '@/lib/keys'

const SaveKeysSchema = z.object({
  anthropic_key: z.string().min(1).optional(),
  gemini_key: z.string().min(1).optional(),
  preferred_ai_provider: z.enum(['anthropic', 'gemini']).optional(),
  apify_token: z.string().min(1).optional(),
  adzuna_app_id: z.string().min(1).optional(),
  adzuna_app_key: z.string().min(1).optional(),
  rapidapi_key: z.string().min(1).optional(),
})

export async function POST(request: Request) {
  const auth = await requireUser()
  if (auth.response) return auth.response
  const { user } = auth

  const body = await request.json()
  const parsed = SaveKeysSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const {
    anthropic_key,
    gemini_key,
    preferred_ai_provider,
    apify_token,
    adzuna_app_id,
    adzuna_app_key,
    rapidapi_key,
  } = parsed.data

  const updates: Partial<typeof userApiKeys.$inferInsert> = { userId: user.id }
  if (anthropic_key) updates.anthropicKey = encrypt(anthropic_key)
  if (gemini_key) updates.geminiKey = encrypt(gemini_key)
  if (preferred_ai_provider) updates.preferredAiProvider = preferred_ai_provider
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
  const auth = await requireUser()
  if (auth.response) return auth.response
  const { user } = auth

  const [keys] = await db
    .select()
    .from(userApiKeys)
    .where(eq(userApiKeys.userId, user.id))
    .limit(1)

  return NextResponse.json({
    anthropic_key: Boolean(keys?.anthropicKey),
    gemini_key: Boolean(keys?.geminiKey),
    preferred_ai_provider: (keys?.preferredAiProvider ?? 'anthropic') as AiProvider,
    apify_token: Boolean(keys?.apifyToken),
    adzuna_app_id: Boolean(keys?.adzunaAppId),
    adzuna_app_key: Boolean(keys?.adzunaAppKey),
    rapidapi_key: Boolean(keys?.rapidapiKey),
  })
}

// Which saved key to remove. `adzuna` clears both the app id and the key.
const DeleteKeySchema = z.enum(['anthropic_key', 'gemini_key', 'apify_token', 'adzuna', 'rapidapi_key']) satisfies z.ZodType<DeletableKeyField>

const COLUMNS_FOR_FIELD: Record<DeletableKeyField, Array<keyof typeof userApiKeys.$inferInsert>> = {
  anthropic_key: ['anthropicKey'],
  gemini_key: ['geminiKey'],
  apify_token: ['apifyToken'],
  adzuna: ['adzunaAppId', 'adzunaAppKey'],
  rapidapi_key: ['rapidapiKey'],
}

export async function DELETE(request: Request) {
  const auth = await requireUser()
  if (auth.response) return auth.response
  const { user } = auth

  const parsed = DeleteKeySchema.safeParse(new URL(request.url).searchParams.get('field'))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Unknown key field' }, { status: 400 })
  }
  const field = parsed.data

  const [row] = await db
    .select()
    .from(userApiKeys)
    .where(eq(userApiKeys.userId, user.id))
    .limit(1)
  if (!row) return NextResponse.json({ success: true })

  const updates: Partial<typeof userApiKeys.$inferInsert> = {}
  for (const column of COLUMNS_FOR_FIELD[field]) {
    ;(updates as Record<string, null>)[column] = null
  }
  // Removing the preferred AI provider's key: switch to the other provider if
  // its key is still saved, so AI features keep working.
  updates.preferredAiProvider = nextPreferredProvider(field, row)

  await db.update(userApiKeys).set(updates).where(eq(userApiKeys.userId, user.id))
  return NextResponse.json({ success: true })
}

// Moved to lib/keys.ts; re-exported for any caller still importing from here.
export { getDecryptedKeys, type ResolvedKeys } from '@/lib/keys'
