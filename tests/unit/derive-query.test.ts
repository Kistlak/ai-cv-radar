import { describe, expect, it, vi } from 'vitest'
import { APIConnectionError, APIError, APIUserAbortError } from '@anthropic-ai/sdk'
import { ApiError as GeminiApiError } from '@google/genai'

vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }))

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

// The AI call failing, rather than its answer being unusable. Temporary
// failures fall back like an unusable answer, so a blank-query search still
// runs; anything else still fails the search with its own message.
const gemini = (status: number, body = '{}') => new GeminiApiError({ status, message: body })
const anthropic = (status: number, type: string) =>
  APIError.generate(status, { type: 'error', error: { type, message: type } }, undefined, new Headers())
const GEMINI_503 = '{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}'

describe('deriveQueriesFromCv when the AI call fails', () => {
  it.each([
    ['Gemini 503 (overloaded)', gemini(503, GEMINI_503)],
    ['Anthropic 529 (overloaded)', anthropic(529, 'overloaded_error')],
    ['Gemini 500', gemini(500)],
    ['our 30 s timeout', new DOMException('The operation was aborted due to timeout', 'TimeoutError')],
    ['our timeout, as the Anthropic SDK reports it', new APIUserAbortError()],
    ['a network failure', new APIConnectionError({ message: 'Connection error.' })],
    ['fetch failing', new TypeError('fetch failed')],
  ])('falls back to the CV role on a temporary error: %s', async (_name, err) => {
    expect(await deriveQueriesFromCv('cv', fakeAi(err).ai, 3, undefined, 'Staff Nurse')).toEqual(['Staff Nurse'])
  })

  it('tells the caller only when the AI could not be reached', async () => {
    const onAiUnavailable = vi.fn()
    await deriveQueriesFromCv('cv', fakeAi(gemini(503, GEMINI_503)).ai, 3, undefined, 'Nurse', onAiUnavailable)
    expect(onAiUnavailable).toHaveBeenCalledTimes(1)

    onAiUnavailable.mockClear()
    await deriveQueriesFromCv('cv', fakeAi('no json').ai, 3, undefined, 'Nurse', onAiUnavailable) // unusable answer
    await deriveQueriesFromCv('cv', fakeAi('["ICU Nurse"]').ai, 3, undefined, 'Nurse', onAiUnavailable)
    expect(onAiUnavailable).not.toHaveBeenCalled()
  })

  it("falls back to 'jobs' without a role", async () => {
    expect(await deriveQueriesFromCv('cv', fakeAi(gemini(503, GEMINI_503)).ai)).toEqual(['jobs'])
  })

  it('still stops when the user cancelled the search', async () => {
    const controller = new AbortController()
    controller.abort()
    const err = new APIUserAbortError()
    await expect(deriveQueriesFromCv('cv', fakeAi(err).ai, 3, controller.signal, 'Staff Nurse')).rejects.toBe(err)
  })

  it.each([
    ['Gemini 400', gemini(400)],
    ['Anthropic 401 (bad key)', anthropic(401, 'authentication_error')],
    ['Gemini 429 (quota)', gemini(429, '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}')],
    ['a plain error', new Error('boom')],
  ])('still fails the search on anything else: %s', async (_name, err) => {
    await expect(deriveQueriesFromCv('cv', fakeAi(err).ai, 3, undefined, 'Staff Nurse')).rejects.toBe(err)
  })
})
