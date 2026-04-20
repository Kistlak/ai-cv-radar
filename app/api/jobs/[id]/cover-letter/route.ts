import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { jobResults } from '@/db/schema'
import { loadJobAIContext, jobDescriptionForPrompt } from '@/lib/job-ai-helpers'

async function generateCoverLetter(
  cvText: string,
  jobBlock: string,
  anthropicKey: string
): Promise<string> {
  const client = new Anthropic({ apiKey: anthropicKey })

  const prompt = `Write a tailored cover letter for this candidate and this specific job.

CANDIDATE CV:
${cvText.slice(0, 5000)}

JOB:
${jobBlock}

Rules:
- 250-350 words, 3-4 short paragraphs.
- Open with a specific hook tied to the company or role — not "I am writing to apply for...".
- Back every claim with a concrete CV detail (project, tech, metric, years). Do not invent anything.
- Address the job's top 2-3 requirements explicitly.
- Close with a short, confident call to action.
- Plain prose only. No markdown, no headings, no bullet lists, no placeholders like [Company] or [Your Name].
- Do not include a date or a postal address block. Start directly with the salutation ("Dear Hiring Team," is fine if no name is known).
- Return ONLY the letter text, nothing else.`

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  })

  const content = message.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type')
  return content.text.trim()
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

  if (!regenerate && job.coverLetter) {
    return NextResponse.json({ coverLetter: job.coverLetter, cached: true })
  }

  try {
    const coverLetter = await generateCoverLetter(cvText, jobDescriptionForPrompt(job), anthropicKey)
    await db.update(jobResults).set({ coverLetter }).where(eq(jobResults.id, id))
    return NextResponse.json({ coverLetter, cached: false })
  } catch (err) {
    console.error('[cover-letter] failed:', err)
    return NextResponse.json({ error: 'Cover letter generation failed' }, { status: 500 })
  }
}
