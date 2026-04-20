import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { jobResults } from '@/db/schema'
import { loadJobAIContext, jobDescriptionForPrompt } from '@/lib/job-ai-helpers'

export interface DeepDive {
  fitSummary: string
  strengths: string[]
  gaps: string[]
  emphasis: string[]
}

function isDeepDive(v: unknown): v is DeepDive {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.fitSummary === 'string' &&
    Array.isArray(o.strengths) &&
    Array.isArray(o.gaps) &&
    Array.isArray(o.emphasis)
  )
}

async function generateDeepDive(
  cvText: string,
  jobBlock: string,
  anthropicKey: string
): Promise<DeepDive> {
  const client = new Anthropic({ apiKey: anthropicKey })

  const prompt = `You are a career coach helping a candidate decide whether to apply to a specific job and how to tailor their application.

CANDIDATE CV:
${cvText.slice(0, 5000)}

JOB:
${jobBlock}

Return ONLY a single JSON object, no prose before or after, with this exact shape:
{
  "fitSummary": "1-2 sentences — honest overall fit assessment grounded in concrete tech/skill alignment.",
  "strengths": ["3-5 bullets: CV items that directly match the job's requirements. Be specific — name the tech, the years, or the accomplishment."],
  "gaps": ["2-4 bullets: job requirements NOT on the CV, or weakly represented. Name each one concretely."],
  "emphasis": ["2-3 bullets: tactical tips on what to emphasize in CV/cover letter/interview for THIS job."]
}

Rules:
- Do not invent skills that aren't on the CV.
- If a gap is a hard blocker (e.g., required cert the candidate lacks), say so in fitSummary.
- Keep each bullet under 25 words.`

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  })

  const content = message.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type')
  const match = content.text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON object in response')

  const parsed: unknown = JSON.parse(match[0])
  if (!isDeepDive(parsed)) throw new Error('Response did not match expected shape')
  return parsed
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const regenerate = new URL(req.url).searchParams.get('regenerate') === '1'

  const loaded = await loadJobAIContext(id, user.id)
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  const { job, cvText, anthropicKey } = loaded.ctx

  if (!regenerate && job.deepDive && isDeepDive(job.deepDive)) {
    return NextResponse.json({ deepDive: job.deepDive, cached: true })
  }

  try {
    const deepDive = await generateDeepDive(cvText, jobDescriptionForPrompt(job), anthropicKey)
    await db.update(jobResults).set({ deepDive }).where(eq(jobResults.id, id))
    return NextResponse.json({ deepDive, cached: false })
  } catch (err) {
    console.error('[deep-dive] failed:', err)
    return NextResponse.json({ error: 'Deep-dive generation failed' }, { status: 500 })
  }
}
