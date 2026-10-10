import { describe, expect, it } from 'vitest'
import { ApiError } from '@google/genai'
import { parseRateLimit } from '@/lib/ai/gemini-retry'

const body = (quotaId: string, extra: Record<string, unknown> = {}, text = '') =>
  JSON.stringify({
    error: {
      code: 429,
      message: `You exceeded your current quota. ${text}`,
      status: 'RESOURCE_EXHAUSTED',
      details: [
        { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId }] },
        ...(Object.keys(extra).length ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', ...extra }] : []),
      ],
    },
  })

const err429 = (message: string) => new ApiError({ status: 429, message })

describe('parseRateLimit', () => {
  it('reads a per-minute limit and its retryDelay', () => {
    expect(
      parseRateLimit(err429(body('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', { retryDelay: '37s' })))
    ).toEqual({ perDay: false, retryAfterMs: 37_000 })
  })

  it('falls back to the "retry in" text, then to 10 s', () => {
    expect(parseRateLimit(err429(body('PerMinute', {}, 'Please retry in 12.5s.')))).toEqual({
      perDay: false,
      retryAfterMs: 12_500,
    })
    expect(parseRateLimit(err429(body('PerMinute', {}, 'Please retry in 800ms.')))).toEqual({
      perDay: false,
      retryAfterMs: 1_000, // clamped up to 1 s
    })
    expect(parseRateLimit(err429('{"error":{"code":429}}'))).toEqual({ perDay: false, retryAfterMs: 10_000 })
  })

  it('flags a per-day limit', () => {
    expect(
      parseRateLimit(err429(body('GenerateRequestsPerDayPerProjectPerModel-FreeTier', { retryDelay: '21926s' })))
    ).toMatchObject({ perDay: true })
  })

  it('clamps long delays to 60 s', () => {
    expect(parseRateLimit(err429(body('PerMinute', { retryDelay: '300s' })))?.retryAfterMs).toBe(60_000)
  })

  it('ignores anything that is not a 429', () => {
    expect(parseRateLimit(new ApiError({ status: 400, message: 'bad' }))).toBeNull()
    expect(parseRateLimit(new Error('network'))).toBeNull()
    expect(parseRateLimit('x')).toBeNull()
  })
})
