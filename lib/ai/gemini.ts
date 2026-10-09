import { GoogleGenAI, ThinkingLevel } from '@google/genai'
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

export function createGeminiClient(apiKey: string): AiClient {
  const client = new GoogleGenAI({ apiKey })

  return {
    provider: 'gemini',
    async complete({ prompt, maxTokens, tier, system, timeoutMs, signal }: AiCompletionOptions): Promise<string> {
      const abortSignal = completionSignal({ signal, timeoutMs })
      const response = await client.models.generateContent({
        model: tier === 'fast' ? FAST_MODEL : SMART_MODEL,
        contents: prompt,
        config: {
          maxOutputTokens: maxTokens,
          thinkingConfig: { thinkingLevel: THINKING_LEVEL },
          ...(system ? { systemInstruction: system } : {}),
          ...(abortSignal ? { abortSignal } : {}),
        },
      })
      const text = response.text
      if (!text) {
        throw new Error('Gemini: empty response')
      }
      return text
    },
  }
}
