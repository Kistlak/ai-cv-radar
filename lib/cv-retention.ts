import { and, count, desc, eq, notExists, sql } from 'drizzle-orm'
import type { SupabaseClient } from '@supabase/supabase-js'
import { db } from '@/db'
import { cvs, searches } from '@/db/schema'
import { logger } from '@/lib/logger'

const BUCKET = 'cvs'

export interface CvListItem {
  id: string
  createdAt: Date
  isActive: boolean
  searchCount: number
}

// The user's CVs, newest first, with how many searches each one backs.
export async function listCvs(userId: string): Promise<CvListItem[]> {
  return db
    .select({
      id: cvs.id,
      createdAt: cvs.createdAt,
      isActive: cvs.isActive,
      searchCount: count(searches.id),
    })
    .from(cvs)
    .leftJoin(searches, eq(searches.cvId, cvs.id))
    .where(eq(cvs.userId, userId))
    .groupBy(cvs.id)
    .orderBy(desc(cvs.createdAt))
}

export type DeleteCvResult =
  | { ok: true; deletedSearches: number }
  | { ok: false; reason: 'not_found' | 'active' | 'storage_failed' }

// Deletes one of the user's CVs: the PDF in storage, then the row. Its searches
// and their results go with it (FK cascade). The active CV can't be deleted.
// If the file can't be removed the row is kept, so a CV row never outlives
// knowledge of its file and nothing is left orphaned silently.
export async function deleteCv(
  userId: string,
  cvId: string,
  supabase: SupabaseClient
): Promise<DeleteCvResult> {
  const [cv] = await db
    .select({ id: cvs.id, filePath: cvs.filePath, isActive: cvs.isActive })
    .from(cvs)
    .where(and(eq(cvs.id, cvId), eq(cvs.userId, userId)))
    .limit(1)
  if (!cv) return { ok: false, reason: 'not_found' }
  if (cv.isActive) return { ok: false, reason: 'active' }

  const [{ n }] = await db.select({ n: count() }).from(searches).where(eq(searches.cvId, cv.id))

  const { error } = await supabase.storage.from(BUCKET).remove([cv.filePath])
  if (error) {
    logger.error({ event: 'cv_retention.storage_delete_failed', userId, cvId, err: error })
    return { ok: false, reason: 'storage_failed' }
  }

  await db.delete(cvs).where(and(eq(cvs.id, cv.id), eq(cvs.userId, userId)))
  logger.info({ event: 'cv_retention.deleted', userId, cvId, deletedSearches: n })
  return { ok: true, deletedSearches: n }
}

// After an upload: removes the user's inactive CVs that no search uses (they
// can't be seen or used anywhere). Best-effort: a failure is logged and that
// CV skipped; it never fails the upload. Returns how many were removed.
export async function pruneUnusedCvs(userId: string, supabase: SupabaseClient): Promise<number> {
  const unused = await db
    .select({ id: cvs.id, filePath: cvs.filePath })
    .from(cvs)
    .where(
      and(
        eq(cvs.userId, userId),
        eq(cvs.isActive, false),
        notExists(db.select({ one: sql`1` }).from(searches).where(eq(searches.cvId, cvs.id)))
      )
    )

  let removed = 0
  for (const cv of unused) {
    const { error } = await supabase.storage.from(BUCKET).remove([cv.filePath])
    if (error) {
      logger.warn({ event: 'cv_retention.prune_storage_failed', userId, cvId: cv.id, err: error })
      continue
    }
    await db.delete(cvs).where(and(eq(cvs.id, cv.id), eq(cvs.userId, userId)))
    removed++
  }
  if (removed > 0) logger.info({ event: 'cv_retention.pruned', userId, removed })
  return removed
}
