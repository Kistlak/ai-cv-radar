export type AiProvider = 'anthropic' | 'gemini'

export type AiTier = 'fast' | 'smart'

export interface AiCompletionOptions {
  prompt: string
  maxTokens: number
  tier: AiTier
  system?: string
}

export interface AiClient {
  provider: AiProvider
  complete(opts: AiCompletionOptions): Promise<string>
}
