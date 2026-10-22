import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from '@anthropic-ai/sdk'
import { ApiError as GeminiApiError } from '@google/genai'
import { isOverloaded } from '@/lib/ai/gemini-retry'

export const AI_TIMEOUT_MESSAGE = 'The AI provider took too long to respond. Please try again.'
export const AI_BUSY_MESSAGE = 'The AI provider is busy right now. Please try again in a few minutes.'

// The message saved on a failed search and shown to the user. Our AI calls are
// aborted by a timeout signal, which surfaces as raw SDK text ("Request was
// aborted.", "The operation was aborted due to timeout"), so those become one
// readable message. User cancels never get here: a cancelled search keeps its
// 'cancelled' status. Everything else keeps its own message.
export function searchErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Unknown error'
  if (
    err instanceof APIUserAbortError ||
    err instanceof APIConnectionTimeoutError ||
    err.name === 'TimeoutError' ||
    err.name === 'AbortError'
  ) {
    return AI_TIMEOUT_MESSAGE
  }
  // Overloaded after the retries: Gemini 503, Anthropic 529. Their raw text is a
  // JSON error body. Only the SDKs' own errors are checked, so another error that
  // happens to mention "UNAVAILABLE" keeps its message.
  if (
    (err instanceof GeminiApiError && isOverloaded(err)) ||
    (err instanceof APIError && err.status === 529)
  ) {
    return AI_BUSY_MESSAGE
  }
  return err.message
}

// Socket and DNS codes Node's fetch (undici) puts on a failed request's cause.
const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
])

function isNetworkCause(cause: unknown): boolean {
  const code = (cause as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' && NETWORK_ERROR_CODES.has(code)
}

// An AI call that failed for a reason that may pass on its own: a timeout
// (Anthropic reports our timeout signal as APIUserAbortError; a user cancel is
// told apart by the caller's signal), the model overloaded, a server error or
// a network failure. Request, key and quota errors (4xx, including 429) aren't
// temporary: they'd fail the same way again.
export function isTransientAiError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  if (
    err instanceof APIUserAbortError ||
    err instanceof APIConnectionTimeoutError ||
    err.name === 'TimeoutError' ||
    err.name === 'AbortError'
  ) {
    return true
  }
  if (err instanceof APIConnectionError) return true
  if (err instanceof TypeError && (err.message === 'fetch failed' || isNetworkCause(err.cause))) return true
  if (err instanceof GeminiApiError) return isOverloaded(err) || err.status >= 500
  if (err instanceof APIError) return typeof err.status === 'number' && err.status >= 500
  return false
}
