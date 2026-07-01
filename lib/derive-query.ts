import type { AiClient } from '@/lib/ai/provider'

export async function deriveQueriesFromCv(
  cvText: string,
  ai: AiClient,
  count = 3
): Promise<string[]> {
  const text = await ai.complete({
    tier: 'fast',
    maxTokens: 300,
    prompt: `Based on this CV, generate ${count} complementary job search queries to cast a wide net while staying relevant to the candidate's actual stack.

Rules:
- Each query is 2–5 words (like a LinkedIn search)
- Complementary, not identical (different angles: specific role, broader role, alternative framing)
- ONLY use technologies/frameworks that appear in the CV — do not invent skills
- Reflect the candidate's seniority level

Return ONLY a JSON array of ${count} strings, no explanation. Example:
["Senior Laravel Developer", "PHP Backend Engineer", "Full-stack PHP Developer"]

CV:
${cvText.slice(0, 4000)}`,
  })

  try {
    const match = text.match(/\[[\s\S]*?\]/)
    if (!match) throw new Error('No array found')
    const arr = JSON.parse(match[0]) as unknown
    if (!Array.isArray(arr)) throw new Error('Not an array')
    const filtered = arr
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .map((s) => s.trim().slice(0, 100))
      .slice(0, count)
    return filtered.length > 0 ? filtered : ['Software Engineer']
  } catch {
    return ['Software Engineer']
  }
}

export async function deriveQueryFromCv(cvText: string, ai: AiClient): Promise<string> {
  const [first] = await deriveQueriesFromCv(cvText, ai, 1)
  return first ?? 'Software Engineer'
}
