import { beforeEach, describe, expect, it, vi } from 'vitest'

// Captures what the Gemini client sends to the SDK.
const generateContent = vi.fn()
vi.mock('@google/genai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@google/genai')>()
  return {
    ...actual,
    GoogleGenAI: vi.fn(function () {
      return { models: { generateContent } }
    }),
  }
})

const { createGeminiClient } = await import('@/lib/ai/gemini')

describe('createGeminiClient', () => {
  beforeEach(() => {
    generateContent.mockReset()
    generateContent.mockResolvedValue({ text: '[]' })
  })

  // gemini-2.5-flash returns 404 "no longer available to new users" for new keys.
  it.each(['fast', 'smart'] as const)('uses a model new keys can call (%s tier)', async (tier) => {
    await createGeminiClient('key').complete({ prompt: 'p', maxTokens: 100, tier })
    expect(generateContent.mock.calls[0][0].model).toBe('gemini-3.8-flash')
  })

  // Thinking tokens count toward maxOutputTokens; at the default level a
  // 1,500-token scoring call spent 1,411 on thinking and was cut off.
  it('keeps thinking low so the answer fits in maxTokens', async () => {
    await createGeminiClient('key').complete({ prompt: 'p', maxTokens: 1500, tier: 'fast' })
    const { config } = generateContent.mock.calls[0][0]
    expect(config.maxOutputTokens).toBe(1500)
    expect(config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' })
  })
})
