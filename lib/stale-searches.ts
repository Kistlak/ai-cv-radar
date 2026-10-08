import { and, eq, lt, sql } from 'drizzle-orm'
import { db } from '@/db'
import { searches } from '@/db/schema'
import { logger } from '@/lib/logger'

// The search route's maxDuration is 300s, so a search still 'running' after
// this long was killed mid-run and will never finish on its own.
export const STALE_SEARCH_MS = 6 * 60 * 1000

export const STALE_SEARCH_ERROR = 'Search timed out. Please try again.'

// Marks the user's stranded searches as failed. Compares against the DB clock,
// and only touches rows still 'running', so it can't overwrite a search that
// has just completed or been cancelled. Best-effort: callers only need to read,
// so a failure is logged and the next read retries.
export async function failStaleSearches(userId: string): Promise<void> {
  try {
    await db
      .update(searches)
      .set({ status: 'failed', error: STALE_SEARCH_ERROR, completedAt: sql`now()` })
      .where(
        and(
          eq(searches.userId, userId),
          eq(searches.status, 'running'),
          lt(searches.createdAt, sql`now() - ${STALE_SEARCH_MS}::int * interval '1 millisecond'`)
        )
      )
  } catch (err) {
    logger.warn({ event: 'stale_searches.reap_failed', userId, err })
  }
}

// True when a 'running' search is past the cut-off (by the app clock), i.e.
// worth running the reaper for.
export function isStale(createdAt: Date, now: number = Date.now()): boolean {
  return now - createdAt.getTime() > STALE_SEARCH_MS
}
