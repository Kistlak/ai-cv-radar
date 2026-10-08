import { beforeEach, describe, expect, it, vi } from 'vitest'

// Each awaited db query takes the next queued result. Queries that are only
// built (e.g. the notExists sub-select) are never awaited and consume nothing.
const state = vi.hoisted(() => ({
  results: [] as unknown[][],
  deletes: 0,
}))

vi.mock('@/db', () => {
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {}
    for (const m of ['from', 'where', 'limit', 'leftJoin', 'groupBy', 'orderBy']) c[m] = () => c
    c.then = (resolve: (v: unknown) => void) => resolve(state.results.shift() ?? [])
    return c
  }
  return {
    db: {
      select: () => chain(),
      delete: () => ({
        where: async () => {
          state.deletes++
        },
      }),
    },
  }
})
vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }))

import { deleteCv, pruneUnusedCvs } from '@/lib/cv-retention'

function fakeStorage(failFor: string[] = []) {
  const removed: string[] = []
  const supabase = {
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          if (paths.some((p) => failFor.includes(p))) return { error: { message: 'storage down' } }
          removed.push(...paths)
          return { error: null }
        },
      }),
    },
  }
  return { supabase: supabase as never, removed }
}

beforeEach(() => {
  state.results = []
  state.deletes = 0
})

describe('deleteCv', () => {
  it("returns not_found for a CV that isn't the user's", async () => {
    state.results = [[]]
    const { supabase, removed } = fakeStorage()
    expect(await deleteCv('u1', 'cv-x', supabase)).toEqual({ ok: false, reason: 'not_found' })
    expect(removed).toEqual([])
    expect(state.deletes).toBe(0)
  })

  it('refuses to delete the active CV', async () => {
    state.results = [[{ id: 'cv-1', filePath: 'u1/1.pdf', isActive: true }]]
    const { supabase, removed } = fakeStorage()
    expect(await deleteCv('u1', 'cv-1', supabase)).toEqual({ ok: false, reason: 'active' })
    expect(removed).toEqual([])
    expect(state.deletes).toBe(0)
  })

  it('removes the file, then the row, and reports the searches deleted with it', async () => {
    state.results = [[{ id: 'cv-1', filePath: 'u1/1.pdf', isActive: false }], [{ n: 3 }]]
    const { supabase, removed } = fakeStorage()
    expect(await deleteCv('u1', 'cv-1', supabase)).toEqual({ ok: true, deletedSearches: 3 })
    expect(removed).toEqual(['u1/1.pdf'])
    expect(state.deletes).toBe(1)
  })

  it('keeps the row when the file cannot be removed', async () => {
    state.results = [[{ id: 'cv-1', filePath: 'u1/1.pdf', isActive: false }], [{ n: 0 }]]
    const { supabase } = fakeStorage(['u1/1.pdf'])
    expect(await deleteCv('u1', 'cv-1', supabase)).toEqual({ ok: false, reason: 'storage_failed' })
    expect(state.deletes).toBe(0)
  })
})

describe('pruneUnusedCvs', () => {
  it('removes each unused inactive CV (file, then row)', async () => {
    state.results = [[{ id: 'a', filePath: 'u1/a.pdf' }, { id: 'b', filePath: 'u1/b.pdf' }]]
    const { supabase, removed } = fakeStorage()
    expect(await pruneUnusedCvs('u1', supabase)).toBe(2)
    expect(removed).toEqual(['u1/a.pdf', 'u1/b.pdf'])
    expect(state.deletes).toBe(2)
  })

  it('skips a CV whose file fails to delete, and carries on', async () => {
    state.results = [[{ id: 'a', filePath: 'u1/a.pdf' }, { id: 'b', filePath: 'u1/b.pdf' }]]
    const { supabase, removed } = fakeStorage(['u1/a.pdf'])
    expect(await pruneUnusedCvs('u1', supabase)).toBe(1)
    expect(removed).toEqual(['u1/b.pdf'])
    expect(state.deletes).toBe(1)
  })

  it('does nothing when there are no unused CVs', async () => {
    state.results = [[]]
    const { supabase } = fakeStorage()
    expect(await pruneUnusedCvs('u1', supabase)).toBe(0)
    expect(state.deletes).toBe(0)
  })
})
