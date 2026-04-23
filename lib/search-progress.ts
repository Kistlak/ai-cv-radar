import { db } from '@/db'
import { searches } from '@/db/schema'
import { eq } from 'drizzle-orm'

export type SearchStage =
  | 'starting'
  | 'deriving-queries'
  | 'fetching'
  | 'scoring'
  | 'persisting'

export interface SearchProgress {
  stage: SearchStage
  queries?: string[]
  cheapSources?: string[]
  cheapDone?: boolean
  cheapCount?: number
  agentic?: boolean
  agenticDone?: boolean
  agenticCount?: number
  agenticMcpCalls?: number
  totalJobs?: number
  scoredJobs?: number
}

export function isSearchProgress(value: unknown): value is SearchProgress {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SearchProgress).stage === 'string'
  )
}

export function createProgressUpdater(searchId: string) {
  const state: SearchProgress = { stage: 'starting' }
  return async function updateProgress(
    patch: Partial<SearchProgress>
  ): Promise<void> {
    Object.assign(state, patch)
    try {
      await db
        .update(searches)
        .set({ progress: { ...state } })
        .where(eq(searches.id, searchId))
    } catch (err) {
      console.warn('[progress] write failed:', err)
    }
  }
}
