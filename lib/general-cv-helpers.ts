import { db } from '@/db'
import { cvs } from '@/db/schema'
import { desc, eq } from 'drizzle-orm'
import { getDecryptedKeys } from '@/app/api/keys/route'

export interface GeneralCvContext {
  cv: typeof cvs.$inferSelect
  anthropicKey: string
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
  if (!keys?.anthropicKey) return { ok: false, error: 'Anthropic key required', status: 400 }

  return { ok: true, ctx: { cv, anthropicKey: keys.anthropicKey } }
}
