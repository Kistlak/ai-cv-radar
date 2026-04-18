import Anthropic from '@anthropic-ai/sdk'
import type { RawJob } from './job-sources/types'

interface ScoredJob extends RawJob {
  matchScore: number
  matchReason: string
}

interface ScoreResult {
  index: number
  score: number
  reason: string
}

const BATCH_SIZE = 10

function buildPrompt(cvText: string, query: string, jobs: RawJob[]): string {
  const jobList = jobs
    .map((job, i) => {
      const desc = job.description
        ? job.description.replace(/<[^>]+>/g, '').slice(0, 500)
        : 'No description provided.'
      return `[${i}] Title: ${job.title} | Company: ${job.company} | Location: ${job.location ?? 'Unknown'} | Remote: ${job.remote}\nDescription: ${desc}`
    })
    .join('\n\n')

  return `You are a STRICT job matching expert. You must reject jobs that don't truly fit the candidate.

CANDIDATE CV:
${cvText.slice(0, 3500)}

CANDIDATE IS LOOKING FOR: ${query}

SCORING SCALE (be strict — most jobs from generic job-board searches are NOT good fits):
- 90–100: Perfect match. Required stack, seniority, and role type all align with candidate's CV and target role.
- 70–89: Strong match. Core tech stack matches; minor gaps are acceptable.
- 50–69: Decent match. Same domain/role type, but meaningful skill gaps exist.
- 20–49: Weak match. Related area but core tech stack differs.
- 0–19: Poor match. Fundamentally different tech stack, seniority mismatch, or unrelated role.

CRITICAL RULES:
1. If the job's PRIMARY required language/framework is NOT in the candidate's CV, score must be 0–19. Example: CV shows PHP/Laravel, job requires Python → score 5–15.
2. If the job title is unrelated to "${query}" (e.g., looking for "Laravel Developer" but job is "Data Scientist"), score must be 0–19.
3. Do NOT reward mere topical relevance (e.g., "both are backend roles"). Stack alignment is what matters.
4. Be especially harsh on seniority mismatches: a senior candidate applying to a junior role (or vice versa) should score below 40.
5. The reason field must explicitly mention the matching (or mismatching) tech/skills — be concrete, not generic.

Return ONLY a JSON array, no prose before or after:
[{"index": 0, "score": 85, "reason": "Requires Laravel + Vue, both strong on CV. Senior level matches 5+ years experience."}, ...]

JOBS TO SCORE:
${jobList}`
}

async function scoreBatch(
  client: Anthropic,
  cvText: string,
  query: string,
  batch: RawJob[]
): Promise<ScoreResult[]> {
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    messages: [{ role: 'user', content: buildPrompt(cvText, query, batch) }],
  })

  const content = message.content[0]
  if (content.type !== 'text') return batch.map((_, i) => ({ index: i, score: 30, reason: '' }))

  try {
    const match = content.text.match(/\[[\s\S]*\]/)
    if (!match) throw new Error('No JSON array found')
    return JSON.parse(match[0]) as ScoreResult[]
  } catch {
    return batch.map((_, i) => ({ index: i, score: 30, reason: 'Score unavailable' }))
  }
}

export async function scoreJobs(
  jobs: RawJob[],
  cvText: string,
  query: string,
  anthropicKey: string
): Promise<ScoredJob[]> {
  if (jobs.length === 0) return []

  const client = new Anthropic({ apiKey: anthropicKey })
  const scored: ScoredJob[] = []

  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE)
    const results = await scoreBatch(client, cvText, query, batch)

    for (let j = 0; j < batch.length; j++) {
      const result = results.find((r) => r.index === j)
      scored.push({
        ...batch[j],
        matchScore: result?.score ?? 30,
        matchReason: result?.reason ?? '',
      })
    }
  }

  return scored
}
