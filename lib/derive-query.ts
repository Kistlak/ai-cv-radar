import Anthropic from '@anthropic-ai/sdk'

export async function deriveQueriesFromCv(
  cvText: string,
  anthropicKey: string,
  count = 3
): Promise<string[]> {
  const client = new Anthropic({ apiKey: anthropicKey })

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `Based on this CV, generate ${count} complementary job search queries to cast a wide net while staying relevant to the candidate's actual stack.

Rules:
- Each query is 2–5 words (like a LinkedIn search)
- Complementary, not identical (different angles: specific role, broader role, alternative framing)
- ONLY use technologies/frameworks that appear in the CV — do not invent skills
- Reflect the candidate's seniority level

Return ONLY a JSON array of ${count} strings, no explanation. Example:
["Senior Laravel Developer", "PHP Backend Engineer", "Full-stack PHP Developer"]

CV:
${cvText.slice(0, 4000)}`,
    }],
  })

  const content = message.content[0]
  if (content.type !== 'text') return ['Software Engineer']

  try {
    const match = content.text.match(/\[[\s\S]*?\]/)
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

export async function deriveQueryFromCv(
  cvText: string,
  anthropicKey: string
): Promise<string> {
  const [first] = await deriveQueriesFromCv(cvText, anthropicKey, 1)
  return first ?? 'Software Engineer'
}
