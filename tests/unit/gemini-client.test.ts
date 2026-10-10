import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Captures what the Gemini client sends to the SDK.
const generateContent = vi.fn()
vi.mock('@google/genai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@google/genai')>()
  return {
    ...actual,
    GoogleGenAI: vi.fn(function () {
      return { models: { generateContent } }
    }),
  }
})

const { createGeminiClient } = await import('@/lib/ai/gemini')
const { ApiError } = await import('@google/genai')

const PER_MINUTE = 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier'
const PER_DAY = 'GenerateRequestsPerDayPerProjectPerModel-FreeTier'

// A 429 as the SDK throws it: ApiError whose message is the JSON error body,
// with the quota that was hit and how long to wait.
function rateLimited(quotaId: string, retryDelay = '2s') {
  return new ApiError({
    status: 429,
    message: JSON.stringify({
      error: {
        code: 429,
        message: `You exceeded your current quota, please check your plan and billing details.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, model: gemini-3.8-flash\nPlease retry in ${retryDelay.replace('s', '.4s')}.`,
        status: 'RESOURCE_EXHAUSTED',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [
              {
                quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
                quotaId,
              },
            ],
          },
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay },
        ],
      },
    }),
  })
}

describe('createGeminiClient', () => {
  beforeEach(() => {
    generateContent.mockReset()
    generateContent.mockResolvedValue({ text: '[]' })
  })

  // gemini-2.5-flash returns 404 "no longer available to new users" for new keys.
  it.each(['fast', 'smart'] as const)('uses a model new keys can call (%s tier)', async (tier) => {
    await createGeminiClient('key').complete({ prompt: 'p', maxTokens: 100, tier })
    expect(generateContent.mock.calls[0][0].model).toBe('gemini-3.8-flash')
  })

  // Thinking tokens count toward maxOutputTokens; at the default level a
  // 1,500-token scoring call spent 1,411 on thinking and was cut off.
  it('keeps thinking low so the answer fits in maxTokens', async () => {
    await createGeminiClient('key').complete({ prompt: 'p', maxTokens: 1500, tier: 'fast' })
    const { config } = generateContent.mock.calls[0][0]
    expect(config.maxOutputTokens).toBe(1500)
    expect(config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' })
  })
})

// On the free tier a search's parallel scoring calls can exceed the per-minute
// limit; Gemini answers 429 with a retry delay, and the call should wait and retry.
describe('createGeminiClient rate limits', () => {
  beforeEach(() => {
    generateContent.mockReset()
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0) // no jitter
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const complete = (opts: { timeoutMs?: number; signal?: AbortSignal } = {}) =>
    createGeminiClient('key').complete({ prompt: 'p', maxTokens: 100, tier: 'fast', ...opts })

  it('waits the requested delay after a per-minute 429 and retries', async () => {
    generateContent
      .mockRejectedValueOnce(rateLimited(PER_MINUTE, '2s'))
      .mockResolvedValueOnce({ text: '[1]' })
    const result = complete()
    await vi.advanceTimersByTimeAsync(1999)
    expect(generateContent).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toBe('[1]')
    expect(generateContent).toHaveBeenCalledTimes(2)
  })

  it('retries at most twice', async () => {
    generateContent
      .mockRejectedValueOnce(rateLimited(PER_MINUTE))
      .mockRejectedValueOnce(rateLimited(PER_MINUTE))
      .mockResolvedValueOnce({ text: '[2]' })
    const ok = complete()
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(ok).resolves.toBe('[2]')
    expect(generateContent).toHaveBeenCalledTimes(3)

    generateContent.mockReset()
    generateContent.mockRejectedValue(rateLimited(PER_MINUTE))
    const failed = complete()
    const assertion = expect(failed).rejects.toMatchObject({ status: 429 })
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
    expect(generateContent).toHaveBeenCalledTimes(3)
  })

  it('does not retry a per-day 429, another error or an empty response', async () => {
    generateContent.mockRejectedValueOnce(rateLimited(PER_DAY, '20000s'))
    await expect(complete()).rejects.toMatchObject({ status: 429 })
    expect(generateContent).toHaveBeenCalledTimes(1)

    generateContent.mockReset()
    generateContent.mockRejectedValueOnce(new ApiError({ status: 400, message: 'bad request' }))
    await expect(complete()).rejects.toMatchObject({ status: 400 })
    expect(generateContent).toHaveBeenCalledTimes(1)

    generateContent.mockReset()
    generateContent.mockResolvedValueOnce({ text: '' })
    await expect(complete()).rejects.toThrow('Gemini: empty response')
    expect(generateContent).toHaveBeenCalledTimes(1)
  })

  it("fails at once when the delay wouldn't fit in the call's timeout", async () => {
    generateContent.mockRejectedValueOnce(rateLimited(PER_MINUTE, '30s'))
    await expect(complete({ timeoutMs: 5_000 })).rejects.toMatchObject({ status: 429 })
    expect(generateContent).toHaveBeenCalledTimes(1)
  })

  it('stops waiting when the call is cancelled', async () => {
    generateContent.mockRejectedValueOnce(rateLimited(PER_MINUTE, '30s'))
    const controller = new AbortController()
    const result = complete({ signal: controller.signal })
    const assertion = expect(result).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(1_000)
    controller.abort()
    await assertion
    expect(generateContent).toHaveBeenCalledTimes(1)
  })
})
