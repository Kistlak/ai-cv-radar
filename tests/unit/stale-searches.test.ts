import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  table: null as unknown,
  set: null as unknown,
  where: 0,
  fail: false,
  warned: [] as unknown[],
}))

// Records the update chain; the WHERE conditions are checked manually against the DB.
vi.mock('@/db', () => ({
  db: {
    update: (table: unknown) => {
      calls.table = table
      return {
        set: (values: unknown) => {
          calls.set = values
          return {
            where: async () => {
              calls.where++
              if (calls.fail) throw new Error('db down')
            },
          }
        },
      }
    },
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn: (fields: unknown) => calls.warned.push(fields) },
}))

import { searches } from '@/db/schema'
import {
  STALE_SEARCH_ERROR,
  STALE_SEARCH_MS,
  failStaleSearches,
  isStale,
} from '@/lib/stale-searches'

beforeEach(() => {
  calls.where = 0
  calls.fail = false
  calls.warned = []
})

describe('failStaleSearches', () => {
  it('marks matching searches failed with the timeout message', async () => {
    await failStaleSearches('user-1')
    expect(calls.table).toBe(searches)
    expect(calls.set).toMatchObject({ status: 'failed', error: STALE_SEARCH_ERROR })
    expect(calls.where).toBe(1)
  })

  it('logs and swallows DB errors so read paths keep working', async () => {
    calls.fail = true
    await expect(failStaleSearches('user-1')).resolves.toBeUndefined()
    expect(calls.warned).toHaveLength(1)
  })

  it('uses a cut-off longer than the search route can run', () => {
    // app/api/search/route.ts: maxDuration = 300 (seconds)
    expect(STALE_SEARCH_MS).toBeGreaterThan(300 * 1000)
  })
})

describe('isStale', () => {
  const now = Date.UTC(2026, 9, 8, 12, 0, 0)

  it('is false inside the cut-off', () => {
    expect(isStale(new Date(now - STALE_SEARCH_MS), now)).toBe(false)
  })

  it('is true past the cut-off', () => {
    expect(isStale(new Date(now - STALE_SEARCH_MS - 1), now)).toBe(true)
  })
})
