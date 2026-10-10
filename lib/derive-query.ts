import type { AiClient } from '@/lib/ai/provider'

// Used when the model gives no usable queries: the CV's most recent role when
// the caller has it, otherwise a neutral word (never a profession).
const DEFAULT_QUERY = 'jobs'

export async function deriveQueriesFromCv(
  cvText: string,
  ai: AiClient,
  count = 3,
  signal?: AbortSignal,
  fallbackRole?: string
): Promise<string[]> {
  const fallback = [fallbackRole?.trim().slice(0, 100) || DEFAULT_QUERY]
  const text = await ai.complete({
    tier: 'fast',
    maxTokens: 300,
    // Runs inside the search pipeline's 300s budget; a hung call must not stall it.
    timeoutMs: 30_000,
    signal,
    prompt: `Based on this CV, generate ${count} complementary job search queries to cast a wide net while staying within the candidate's actual field, skills and seniority. The candidate can be in any profession.

Rules:
- Each query is 2–5 words (like a LinkedIn search)
- Complementary, not identical (different angles: specific role, broader role, alternative framing)
- Use the job titles employers in this profession actually post
- ONLY use skills, specialisms and job titles the CV supports — do not invent any
- Reflect the candidate's seniority level
- Write the queries in the same language as the CV

Return ONLY a JSON array of ${count} strings, no explanation. Format examples (for other CVs; don't copy them):
["Senior Python Developer", "Backend Software Engineer", "Django Developer"]
["ICU Staff Nurse", "Critical Care Nurse", "Registered Nurse"]
["Financial Accountant", "Management Accountant IFRS", "Finance Manager"]

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
    return filtered.length > 0 ? filtered : fallback
  } catch {
    return fallback
  }
}

export async function deriveQueryFromCv(cvText: string, ai: AiClient): Promise<string> {
  const [first] = await deriveQueriesFromCv(cvText, ai, 1)
  return first ?? DEFAULT_QUERY
}
