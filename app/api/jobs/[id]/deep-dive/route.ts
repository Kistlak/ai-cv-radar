import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { jobResults } from '@/db/schema'
import { loadJobAIContext, jobDescriptionForPrompt } from '@/lib/job-ai-helpers'
import type { AiClient } from '@/lib/ai/provider'
import { consumeQuota, quotaExceededResponse } from '@/lib/usage-limits'
import { requireUser } from '@/lib/auth'
import { extractJson } from '@/lib/ai/parse-json'
import { DeepDiveSchema, type DeepDive } from '@/lib/ai/schemas'

export type { DeepDive }

function isDeepDive(v: unknown): v is DeepDive {
  return DeepDiveSchema.safeParse(v).success
}

async function generateDeepDive(
  cvText: string,
  jobBlock: string,
  ai: AiClient
): Promise<DeepDive> {
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

  const text = await ai.complete({ tier: 'fast', maxTokens: 1200, prompt, json: true })
  const parsed = DeepDiveSchema.safeParse(extractJson(text, 'object'))
  if (!parsed.success) throw new Error('Response did not match expected shape')
  return parsed.data
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser()
  if (auth.response) return auth.response
  const { user } = auth

  const { id } = await params
  const regenerate = new URL(req.url).searchParams.get('regenerate') === '1'

  const loaded = await loadJobAIContext(id, user.id)
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  const { job, cvText, ai, usingFallback } = loaded.ctx

  if (!regenerate && job.deepDive && isDeepDive(job.deepDive)) {
    return NextResponse.json({ deepDive: job.deepDive, cached: true })
  }

  if (usingFallback) {
    const quota = await consumeQuota(user.id, 'ai_generation')
    if (!quota.ok) return quotaExceededResponse(quota)
  }

  try {
    const deepDive = await generateDeepDive(cvText, jobDescriptionForPrompt(job), ai)
    await db.update(jobResults).set({ deepDive }).where(eq(jobResults.id, id))
    return NextResponse.json({ deepDive, cached: false })
  } catch (err) {
    console.error('[deep-dive] failed:', err)
    return NextResponse.json({ error: 'Deep-dive generation failed' }, { status: 500 })
  }
}
