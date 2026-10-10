// Gemini rate limits (HTTP 429 RESOURCE_EXHAUSTED). The SDK throws an ApiError
// whose message is the JSON error body: it names the quota that was hit (per
// minute or per day) and how long to wait. See lib/ai/gemini.ts for the retry.

export interface RateLimit {
  // A daily quota can't recover for hours, so it isn't worth retrying.
  perDay: boolean
  retryAfterMs: number
}

const DEFAULT_RETRY_MS = 10_000
const MIN_RETRY_MS = 1_000
const MAX_RETRY_MS = 60_000

function toMs(value: string, unit: string | undefined): number {
  return Math.round(Number(value) * (unit === 'ms' ? 1 : 1000))
}

// The rate limit an error describes, or null when it isn't a 429.
export function parseRateLimit(err: unknown): RateLimit | null {
  if (!(err instanceof Error)) return null
  const status = (err as { status?: unknown }).status
  if (status !== 429 && !err.message.includes('RESOURCE_EXHAUSTED')) return null

  const message = err.message
  const perDay = /quotaId"?\s*:\s*"[^"]*PerDay/i.test(message)
  // RetryInfo detail first ("retryDelay": "37s"), then the text "retry in 37.1s".
  const delay =
    message.match(/retryDelay"?\s*:\s*"(\d+(?:\.\d+)?)(ms|s)"/) ??
    message.match(/retry in (\d+(?:\.\d+)?)\s*(ms|s)\b/i)
  const ms = delay ? toMs(delay[1], delay[2]) : DEFAULT_RETRY_MS
  return { perDay, retryAfterMs: Math.min(MAX_RETRY_MS, Math.max(MIN_RETRY_MS, ms)) }
}

// Resolves after `ms`, or rejects with the signal's reason once it aborts.
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(signal!.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
