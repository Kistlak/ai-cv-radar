import { db } from '@/db'
import { cvs } from '@/db/schema'
import { desc, eq } from 'drizzle-orm'
import { getDecryptedKeys } from '@/app/api/keys/route'
import { createAiClient, resolveProvider, type AiClient } from '@/lib/ai/provider'

export interface GeneralCvContext {
  cv: typeof cvs.$inferSelect
  ai: AiClient
}

export async function loadGeneralCvContext(
  userId: string
): Promise<{ ok: true; ctx: GeneralCvContext } | { ok: false; error: string; status: number }> {
  const [cv] = await db
    .select()
    .from(cvs)
    .where(eq(cvs.userId, userId))
    .orderBy(desc(cvs.createdAt))
    .limit(1)
  if (!cv) return { ok: false, error: 'Upload a CV first', status: 400 }

  const keys = await getDecryptedKeys(userId)
  const resolved = resolveProvider(keys.preferredAiProvider, keys)
  if (!resolved) {
    return { ok: false, error: 'Add an Anthropic or Gemini API key in Settings', status: 400 }
  }

  return { ok: true, ctx: { cv, ai: createAiClient(resolved.provider, resolved.apiKey) } }
}
