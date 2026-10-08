import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { userApiKeys } from '@/db/schema'

// Where a key comes from: the user's own (Settings), the operator's shared
// FALLBACK_* env var, or nowhere. Presence only: nothing is decrypted, so
// pages that just show status don't depend on APP_ENCRYPTION_KEY.
export type KeySource = 'user' | 'shared' | null

export interface KeyStatus {
  anthropic: KeySource
  gemini: KeySource
  apify: KeySource
  adzuna: KeySource
  jsearch: KeySource
}

type KeyRow = Pick<
  typeof userApiKeys.$inferSelect,
  'anthropicKey' | 'geminiKey' | 'apifyToken' | 'adzunaAppId' | 'adzunaAppKey' | 'rapidapiKey'
>

function source(userValue: unknown, fallback: string | undefined): KeySource {
  if (userValue) return 'user'
  if (fallback) return 'shared'
  return null
}

// Mirrors getDecryptedKeys: a user's own key wins over the fallback.
export function resolveKeyStatus(
  row: KeyRow | undefined,
  env: Record<string, string | undefined>
): KeyStatus {
  // Adzuna needs both parts. Like getDecryptedKeys, each part falls back on
  // its own; it's 'user' only when the user supplied both.
  const adzunaId = source(row?.adzunaAppId, env.FALLBACK_ADZUNA_APP_ID)
  const adzunaKey = source(row?.adzunaAppKey, env.FALLBACK_ADZUNA_APP_KEY)
  const adzuna: KeySource =
    adzunaId && adzunaKey ? (adzunaId === 'user' && adzunaKey === 'user' ? 'user' : 'shared') : null

  return {
    anthropic: source(row?.anthropicKey, env.FALLBACK_ANTHROPIC_KEY),
    gemini: source(row?.geminiKey, env.FALLBACK_GEMINI_KEY),
    apify: source(row?.apifyToken, env.FALLBACK_APIFY_TOKEN),
    adzuna,
    jsearch: source(row?.rapidapiKey, env.FALLBACK_RAPIDAPI_KEY),
  }
}

// Searching (and CV parsing) needs either AI provider, as resolveProvider does.
export function canUseAi(status: KeyStatus): boolean {
  return Boolean(status.anthropic || status.gemini)
}

export async function getKeyStatus(userId: string): Promise<KeyStatus> {
  const [row] = await db
    .select({
      anthropicKey: userApiKeys.anthropicKey,
      geminiKey: userApiKeys.geminiKey,
      apifyToken: userApiKeys.apifyToken,
      adzunaAppId: userApiKeys.adzunaAppId,
      adzunaAppKey: userApiKeys.adzunaAppKey,
      rapidapiKey: userApiKeys.rapidapiKey,
    })
    .from(userApiKeys)
    .where(eq(userApiKeys.userId, userId))
    .limit(1)
  return resolveKeyStatus(row, process.env)
}
