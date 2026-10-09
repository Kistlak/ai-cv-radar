import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const calls = vi.hoisted(() => ({ where: null as unknown, orderBy: [] as unknown[], limit: 0, rows: [] as unknown[] }))

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          calls.where = w
          return {
            orderBy: (...o: unknown[]) => {
              calls.orderBy = o
              return {
                limit: async (n: number) => {
                  calls.limit = n
                  return calls.rows
                },
              }
            },
          }
        },
      }),
    }),
  },
}))

import { getActiveCv } from '@/lib/cv'

const toSql = (s: unknown) => new PgDialect().sqlToQuery(s as SQL).sql

describe('getActiveCv', () => {
  it('orders active first, then newest, and takes one', async () => {
    calls.rows = [{ id: 'cv-1' }]
    const cv = await getActiveCv('user-1')
    expect(cv).toEqual({ id: 'cv-1' })
    expect(calls.orderBy.map(toSql)).toEqual(['"cvs"."is_active" desc', '"cvs"."created_at" desc'])
    expect(calls.limit).toBe(1)
    expect(toSql(calls.where)).toBe('"cvs"."user_id" = $1')
  })

  it('returns undefined when the user has no CV', async () => {
    calls.rows = []
    expect(await getActiveCv('user-1')).toBeUndefined()
  })
})
