import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { jobResults } from '@/db/schema'
import { loadJobAIContext, jobDescriptionForPrompt } from '@/lib/job-ai-helpers'
import { isCvJson, type CvJson } from '@/lib/cv-docx'

// Alias kept for callers that still import TailoredCv/isTailoredCv.
export type TailoredCv = CvJson
export const isTailoredCv = isCvJson

async function generateTailoredCv(
  cvText: string,
  jobBlock: string,
  anthropicKey: string
): Promise<TailoredCv> {
  const client = new Anthropic({ apiKey: anthropicKey })

  const prompt = `You are a professional CV editor producing an ATS-optimized CV. Restructure the candidate's CV so it is maximally aligned with the specific job below, while staying defensible in an interview.

CANDIDATE CV (primary source of truth):
${cvText.slice(0, 6000)}

JOB:
${jobBlock}

Produce a clean, ATS-friendly CV as JSON. Reorder bullets, re-emphasize relevant achievements, lift exact keywords from the job posting where they appear verbatim in the CV, and rewrite the summary to target THIS job.

Return ONLY a single JSON object, no prose before or after, with this exact shape:
{
  "name": "Full name from CV",
  "title": "Target job title aligned to this role (e.g., 'Senior Backend Engineer')",
  "contact": {
    "email": "string or omit",
    "phone": "string or omit",
    "location": "string or omit",
    "linkedin": "string or omit",
    "website": "string or omit"
  },
  "summary": "3-4 sentence professional summary tailored to this job. Concrete, grounded in CV. Include 2-3 of the job's top keywords naturally.",
  "experience": [
    {
      "company": "Company name",
      "title": "Role",
      "location": "City, Country or Remote (or omit)",
      "startDate": "MMM YYYY or YYYY",
      "endDate": "MMM YYYY or 'Present' or YYYY",
      "bullets": ["3-5 bullets per role, prioritizing items relevant to the job. Quantify when possible."]
    }
  ],
  "education": [
    { "institution": "School", "degree": "Degree + field", "year": "YYYY or omit" }
  ],
  "skills": ["flat list of 12-20 skills ordered by relevance to this job"],
  "certifications": ["only if present in CV; otherwise omit"]
}

HARD rules (never break these):
- Do NOT invent companies, job titles, employment dates, metrics/numbers, accomplishments, degrees, or certifications. These must come only from the CV.
- Do NOT claim years of experience with a technology that is not supported by the CV.
- If a contact field is missing (e.g., no LinkedIn), omit the key — never use an empty string.

Keyword-bridging rule (SKILLS section only):
- Scan the job posting for critical technical/domain keywords missing from the CV's skills.
- You MAY add UP TO 5 such keywords to the "skills" array — but ONLY when they are reasonably adjacent, transferable, or a superset/subset of something the candidate has actually done. Examples:
  - CV has "PostgreSQL" and job wants "MySQL" → OK to add (adjacent relational DB).
  - CV has "React" and job wants "JSX" / "React Hooks" → OK to add (subset).
  - CV has "AWS Lambda + API Gateway" and job wants "serverless" → OK to add (synonym).
  - CV shows 3 years of backend Python and job wants "REST APIs" → OK (implied).
- Do NOT add keywords with no plausible bridge from the CV (e.g., "Rust" when CV is pure JS, "Kubernetes" when no infra/container work is shown, "Salesforce" when no CRM exposure).
- The user must be able to defend every skill listed in an interview. Err on the side of leaving a keyword out if unsure.
- Never use keyword-bridging in summary, experience, or certifications — only skills.

Style rules:
- Keep each bullet under 25 words. Start bullets with strong action verbs (Built, Led, Shipped, Reduced, Designed, Automated, etc.).
- Prefer concrete CV details over generic phrasing.
- "title" should reflect the target role aligned to the job while staying honest about the candidate's level.`

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3500,
    messages: [{ role: 'user', content: prompt }],
  })

  const content = message.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type')
  const match = content.text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON object in response')

  const parsed: unknown = JSON.parse(match[0])
  if (!isCvJson(parsed)) throw new Error('Response did not match expected CV shape')
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

  if (!regenerate && job.tailoredCv && isCvJson(job.tailoredCv)) {
    return NextResponse.json({ tailoredCv: job.tailoredCv, cached: true })
  }

  try {
    const tailoredCv = await generateTailoredCv(cvText, jobDescriptionForPrompt(job), anthropicKey)
    await db.update(jobResults).set({ tailoredCv }).where(eq(jobResults.id, id))
    return NextResponse.json({ tailoredCv, cached: false })
  } catch (err) {
    console.error('[tailored-cv] failed:', err)
    return NextResponse.json({ error: 'Tailored CV generation failed' }, { status: 500 })
  }
}
