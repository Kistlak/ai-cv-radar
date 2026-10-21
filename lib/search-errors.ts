import { APIConnectionTimeoutError, APIError, APIUserAbortError } from '@anthropic-ai/sdk'
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
