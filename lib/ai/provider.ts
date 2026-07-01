import { createAnthropicClient } from './anthropic'
import { createGeminiClient } from './gemini'
import type { AiClient, AiProvider } from './types'

export function createAiClient(provider: AiProvider, apiKey: string): AiClient {
  switch (provider) {
    case 'anthropic':
      return createAnthropicClient(apiKey)
    case 'gemini':
      return createGeminiClient(apiKey)
  }
}

// Resolves which provider a request should use given the user's preference and
// which keys they have configured. If the preferred provider has no key, we fall
// back to whichever provider IS configured. Returns null if neither is available.
export function resolveProvider(
  preferred: AiProvider | undefined,
  keys: { anthropicKey?: string; geminiKey?: string }
): { provider: AiProvider; apiKey: string } | null {
  const anthropic = keys.anthropicKey
  const gemini = keys.geminiKey
  const pref: AiProvider = preferred === 'gemini' ? 'gemini' : 'anthropic'

  if (pref === 'anthropic' && anthropic) return { provider: 'anthropic', apiKey: anthropic }
  if (pref === 'gemini' && gemini) return { provider: 'gemini', apiKey: gemini }
  if (anthropic) return { provider: 'anthropic', apiKey: anthropic }
  if (gemini) return { provider: 'gemini', apiKey: gemini }
  return null
}

export type { AiClient, AiProvider, AiTier, AiCompletionOptions } from './types'
