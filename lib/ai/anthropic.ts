import Anthropic from '@anthropic-ai/sdk'
import { completionSignal, type AiClient, type AiCompletionOptions } from './types'

const FAST_MODEL = process.env.ANTHROPIC_FAST_MODEL || 'claude-haiku-4-5-20251001'
const SMART_MODEL = process.env.ANTHROPIC_SMART_MODEL || 'claude-sonnet-4-6'

export function createAnthropicClient(apiKey: string): AiClient {
  const client = new Anthropic({ apiKey })

  return {
    provider: 'anthropic',
    async complete({ prompt, maxTokens, tier, system, timeoutMs, signal }: AiCompletionOptions): Promise<string> {
      const abortSignal = completionSignal({ signal, timeoutMs })
      const message = await client.messages.create(
        {
          model: tier === 'fast' ? FAST_MODEL : SMART_MODEL,
          max_tokens: maxTokens,
          ...(system ? { system } : {}),
          messages: [{ role: 'user', content: prompt }],
        },
        abortSignal ? { signal: abortSignal } : undefined
      )
      const content = message.content[0]
      if (!content || content.type !== 'text') {
        throw new Error('Anthropic: unexpected non-text response')
      }
      return content.text
    },
  }
}
