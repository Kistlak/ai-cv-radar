import { APIConnectionTimeoutError, APIUserAbortError } from '@anthropic-ai/sdk'

export const AI_TIMEOUT_MESSAGE = 'The AI provider took too long to respond. Please try again.'

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
  return err.message
}
