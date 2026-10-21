import { GoogleGenAI, ThinkingLevel } from '@google/genai'
import { logger } from '@/lib/logger'
import { isOverloaded, parseRateLimit, sleep } from './gemini-retry'
import { completionSignal, type AiClient, type AiCompletionOptions } from './types'

// Flash has a generous free tier and handles both quick and complex prompts well.
// Callers can still request 'smart' — for now both tiers point to flash to stay on free tier.
// (gemini-2.5-flash returns 404 "no longer available to new users" for new keys.)
const FAST_MODEL = process.env.GEMINI_FAST_MODEL || 'gemini-3.8-flash'
const SMART_MODEL = process.env.GEMINI_SMART_MODEL || 'gemini-3.8-flash'

// Thinking tokens count toward maxOutputTokens, and every caller's maxTokens is
// sized for the answer alone. At the default level a 1,500-token scoring call
// spent 1,411 tokens thinking and the JSON was cut off. LOW keeps the budget
// for the answer. (MINIMAL isn't supported by gemini-3.8-flash.)
const THINKING_LEVEL = ThinkingLevel.LOW

// A per-minute 429 (e.g. a search's parallel scoring calls on the free tier) is
// retried after the delay Gemini asks for. A 503 (model overloaded) is retried
// after OVERLOAD_BACKOFF_MS. Both share the retry cap. Per-day 429s and other
// errors aren't retried.
const MAX_RETRIES = 2
const OVERLOAD_BACKOFF_MS = [2_000, 4_000]
const MAX_JITTER_MS = 1_000

export function createGeminiClient(apiKey: string): AiClient {
  const client = new GoogleGenAI({ apiKey })

  return {
    provider: 'gemini',
    async complete({ prompt, maxTokens, tier, system, timeoutMs, signal, json }: AiCompletionOptions): Promise<string> {
      const abortSignal = completionSignal({ signal, timeoutMs })
      const deadline = timeoutMs ? Date.now() + timeoutMs : Infinity
      const request = {
        model: tier === 'fast' ? FAST_MODEL : SMART_MODEL,
        contents: prompt,
        config: {
          maxOutputTokens: maxTokens,
          thinkingConfig: { thinkingLevel: THINKING_LEVEL },
          ...(system ? { systemInstruction: system } : {}),
          ...(abortSignal ? { abortSignal } : {}),
          ...(json ? { responseMimeType: 'application/json' } : {}),
        },
      }

      let response
      for (let attempt = 0; ; attempt++) {
        try {
          response = await client.models.generateContent(request)
          break
        } catch (err) {
          const limit = parseRateLimit(err)
          if (!limit && isOverloaded(err)) {
            // The last back-off repeats if the cap is ever raised past the list.
            const backoffMs = OVERLOAD_BACKOFF_MS[Math.min(attempt, OVERLOAD_BACKOFF_MS.length - 1)]
            const waitMs = backoffMs + Math.floor(Math.random() * MAX_JITTER_MS)
            // Give up at the cap, or when the call's timeout would cut the wait off anyway.
            if (attempt >= MAX_RETRIES || Date.now() + waitMs >= deadline) {
              logger.warn({ event: 'gemini.overloaded', attempt, retrying: false })
              throw err
            }
            logger.warn({ event: 'gemini.overloaded', attempt, retrying: true, waitMs })
            await sleep(waitMs, abortSignal)
            continue
          }
          if (!limit || limit.perDay || attempt >= MAX_RETRIES) {
            if (limit) logger.warn({ event: 'gemini.rate_limited', attempt, perDay: limit.perDay, retrying: false })
            throw err
          }
          const waitMs = limit.retryAfterMs + Math.floor(Math.random() * MAX_JITTER_MS)
          // Don't wait for a retry the call's timeout would cut off anyway.
          if (Date.now() + waitMs >= deadline) throw err
          logger.warn({ event: 'gemini.rate_limited', attempt, perDay: false, retrying: true, waitMs })
          await sleep(waitMs, abortSignal)
        }
      }
      const text = response.text
      if (!text) {
        throw new Error('Gemini: empty response')
      }
      return text
    },
  }
}
