export type AiProvider = 'anthropic' | 'gemini'

export type AiTier = 'fast' | 'smart'

export interface AiCompletionOptions {
  prompt: string
  maxTokens: number
  tier: AiTier
  system?: string
  // Aborts the whole call (including SDK retries) after this long.
  timeoutMs?: number
  // Aborts the call from outside, e.g. when the user cancels the search.
  signal?: AbortSignal
  // The caller expects a JSON object back. Gemini then uses its JSON response
  // mode; Anthropic ignores it (the caller validates with a schema either way).
  json?: boolean
}

// One signal for whichever of `signal` / `timeoutMs` is set, or undefined.
export function completionSignal({
  signal,
  timeoutMs,
}: Pick<AiCompletionOptions, 'signal' | 'timeoutMs'>): AbortSignal | undefined {
  const timeout = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined
  if (signal && timeout) return AbortSignal.any([signal, timeout])
  return signal ?? timeout
}

export interface AiClient {
  provider: AiProvider
  complete(opts: AiCompletionOptions): Promise<string>
}
