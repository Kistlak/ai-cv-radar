import { describe, expect, it, vi } from 'vitest'
import type { AiClient } from '@/lib/ai/types'
import { deriveQueriesFromCv, deriveQueryFromCv } from '@/lib/derive-query'

function fakeAi(response: string | Error) {
  const complete = vi.fn<AiClient['complete']>(async () => {
    if (response instanceof Error) throw response
    return response
  })
  return { ai: { provider: 'gemini', complete } as AiClient, complete }
}

describe('deriveQueriesFromCv', () => {
  it('parses, trims, cuts and caps the queries', async () => {
    const long = 'x'.repeat(150)
    const { ai } = fakeAi(`Here: [" ICU Nurse ", "", 7, "${long}", "Staff Nurse"]`)
    const queries = await deriveQueriesFromCv('cv', ai, 2)
    expect(queries).toEqual(['ICU Nurse', 'x'.repeat(100)])
  })

  it('falls back to the given role when the response has no usable queries', async () => {
    expect(await deriveQueriesFromCv('cv', fakeAi('no json').ai, 3, undefined, ' Staff Nurse ')).toEqual([
      'Staff Nurse',
    ])
    expect(await deriveQueriesFromCv('cv', fakeAi('[]').ai, 3, undefined, 'Staff Nurse')).toEqual([
      'Staff Nurse',
    ])
  })

  it('falls back to a neutral query, never a profession, without a role', async () => {
    expect(await deriveQueriesFromCv('cv', fakeAi('no json').ai)).toEqual(['jobs'])
    expect(await deriveQueriesFromCv('cv', fakeAi('[]').ai, 3, undefined, '  ')).toEqual(['jobs'])
    expect(await deriveQueryFromCv('cv', fakeAi('no json').ai)).toBe('jobs')
  })

  it('uses a prompt for any profession and passes the timeout and signal', async () => {
    const { ai, complete } = fakeAi('["Accountant"]')
    const signal = new AbortController().signal
    await deriveQueriesFromCv('cv', ai, 3, signal)
    const opts = complete.mock.calls[0][0]
    expect(opts.prompt).not.toMatch(/\bstack\b|laravel/i)
    expect(opts.prompt).toMatch(/any profession/)
    expect(opts.timeoutMs).toBe(30_000)
    expect(opts.signal).toBe(signal)
  })
})
