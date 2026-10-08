import { GoogleGenAI } from '@google/genai'
import { completionSignal, type AiClient, type AiCompletionOptions } from './types'

// gemini-2.5-flash has a generous free tier and handles both quick and complex prompts well.
// Callers can still request 'smart' — for now both tiers point to flash to stay on free tier.
const FAST_MODEL = process.env.GEMINI_FAST_MODEL || 'gemini-2.5-flash'
const SMART_MODEL = process.env.GEMINI_SMART_MODEL || 'gemini-2.5-flash'

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
