import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { userApiKeys } from '@/db/schema'
import { decrypt } from '@/lib/crypto'
import { logger } from '@/lib/logger'
import type { AiProvider } from '@/lib/ai/provider'

export interface ResolvedKeys {
  anthropicKey?: string
  geminiKey?: string
  preferredAiProvider: AiProvider
  apifyToken?: string
  adzunaAppId?: string
  adzunaAppKey?: string
  rapidapiKey?: string
  // Per-key flag set when the value came from the operator-provided FALLBACK_*
  // env var instead of the user's own configured key. Useful for telemetry,
  // rate limiting, or showing a "shared key" badge in the UI.
  usingFallback: {
    anthropicKey: boolean
    geminiKey: boolean
    apifyToken: boolean
    adzunaAppId: boolean
    adzunaAppKey: boolean
    rapidapiKey: boolean
  }
}

// One unreadable value (corrupt row, or APP_ENCRYPTION_KEY rotated without
// APP_ENCRYPTION_KEY_PREVIOUS) counts as "not set" for that key only, so the
// fallback applies instead of every feature failing. Never logs the value.
function safeDecrypt(userId: string, field: string, value: string | null | undefined): string | undefined {
  if (!value) return undefined
  try {
    return decrypt(value)
  } catch (err) {
    logger.warn({ event: 'keys.decrypt_failed', userId, field, err })
    return undefined
  }
}

export async function getDecryptedKeys(userId: string): Promise<ResolvedKeys> {
  const [row] = await db
    .select()
    .from(userApiKeys)
    .where(eq(userApiKeys.userId, userId))
    .limit(1)

  const userAnthropic = safeDecrypt(userId, 'anthropic_key', row?.anthropicKey)
  const userGemini = safeDecrypt(userId, 'gemini_key', row?.geminiKey)
  const userApify = safeDecrypt(userId, 'apify_token', row?.apifyToken)
  const userAdzunaId = row?.adzunaAppId ?? undefined
  const userAdzunaKey = safeDecrypt(userId, 'adzuna_app_key', row?.adzunaAppKey)
  const userRapidapi = safeDecrypt(userId, 'rapidapi_key', row?.rapidapiKey)

  const fallbackAnthropic = process.env.FALLBACK_ANTHROPIC_KEY || undefined
  const fallbackGemini = process.env.FALLBACK_GEMINI_KEY || undefined
  const fallbackApify = process.env.FALLBACK_APIFY_TOKEN || undefined
  const fallbackAdzunaId = process.env.FALLBACK_ADZUNA_APP_ID || undefined
  const fallbackAdzunaKey = process.env.FALLBACK_ADZUNA_APP_KEY || undefined
  const fallbackRapidapi = process.env.FALLBACK_RAPIDAPI_KEY || undefined

  const preferred = (row?.preferredAiProvider === 'gemini' ? 'gemini' : 'anthropic') as AiProvider

  return {
    anthropicKey: userAnthropic ?? fallbackAnthropic,
    geminiKey: userGemini ?? fallbackGemini,
    preferredAiProvider: preferred,
    apifyToken: userApify ?? fallbackApify,
    adzunaAppId: userAdzunaId ?? fallbackAdzunaId,
    adzunaAppKey: userAdzunaKey ?? fallbackAdzunaKey,
    rapidapiKey: userRapidapi ?? fallbackRapidapi,
    usingFallback: {
      anthropicKey: !userAnthropic && !!fallbackAnthropic,
      geminiKey: !userGemini && !!fallbackGemini,
      apifyToken: !userApify && !!fallbackApify,
      adzunaAppId: !userAdzunaId && !!fallbackAdzunaId,
      adzunaAppKey: !userAdzunaKey && !!fallbackAdzunaKey,
      rapidapiKey: !userRapidapi && !!fallbackRapidapi,
    },
  }
}

// Saved keys a user can remove from Settings (adzuna = app id + key).
export type DeletableKeyField = 'anthropic_key' | 'gemini_key' | 'apify_token' | 'adzuna' | 'rapidapi_key'

// The preferred provider after a key is removed: if it was the preferred
// provider's key and the other provider still has one, switch to it.
export function nextPreferredProvider(
  removed: DeletableKeyField,
  row: Pick<typeof userApiKeys.$inferSelect, 'preferredAiProvider' | 'anthropicKey' | 'geminiKey'>
): AiProvider {
  const current = (row.preferredAiProvider === 'gemini' ? 'gemini' : 'anthropic') as AiProvider
  if (removed === 'anthropic_key' && current === 'anthropic' && row.geminiKey) return 'gemini'
  if (removed === 'gemini_key' && current === 'gemini' && row.anthropicKey) return 'anthropic'
  return current
}
