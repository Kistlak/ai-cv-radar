import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { cvs } from '@/db/schema'
import { isCvJson, type CvJson } from '@/lib/cv-docx'
import { loadGeneralCvContext } from '@/lib/general-cv-helpers'

async function generateGeneralCv(
  cvText: string,
  anthropicKey: string
): Promise<CvJson> {
  const client = new Anthropic({ apiKey: anthropicKey })

  const prompt = `You are a professional CV editor producing an ATS-optimized, polished general-purpose CV. This CV is NOT tailored to a specific job — it should be a strong, reusable version the candidate can send for similar roles that fit their background.

CANDIDATE CV (primary source of truth):
${cvText.slice(0, 6000)}

Return ONLY a single JSON object, no prose before or after, with this exact shape:
{
  "name": "Full name from CV",
  "title": "Professional title that best represents the candidate's current level and domain (e.g., 'Senior Backend Engineer', 'Marketing Manager'). Use the candidate's latest/highest relevant role.",
  "contact": {
    "email": "string or omit",
    "phone": "string or omit",
    "location": "string or omit",
    "linkedin": "string or omit",
    "website": "string or omit"
  },
  "summary": "3-4 sentence professional summary. Lead with years of experience + domain. Highlight 2-3 core strengths that run through the CV. Avoid clichés ('hard-working', 'team player').",
  "experience": [
    {
      "company": "Company name",
      "title": "Role",
      "location": "City, Country or Remote (or omit)",
      "startDate": "MMM YYYY or YYYY",
      "endDate": "MMM YYYY or 'Present' or YYYY",
      "bullets": ["3-5 bullets per role. Start with strong action verbs. Quantify impact wherever the CV gives numbers."]
    }
  ],
  "education": [
    { "institution": "School", "degree": "Degree + field", "year": "YYYY or omit" }
  ],
  "skills": ["15-25 skills covering the candidate's full toolkit, ordered with the strongest and most-used first. Include both technical and relevant domain skills present in the CV."],
  "certifications": ["only if present in the CV; otherwise omit"]
}

HARD rules (never break these):
- Do NOT invent companies, titles, dates, metrics, accomplishments, degrees, or certifications. Use only what is in the CV.
- Do NOT claim years with a technology that is not supported by the CV.
- Omit any contact field that is missing — never leave empty strings.

Style rules for maximum ATS score + recruiter readability:
- Each bullet under 25 words. Start with strong action verbs (Built, Led, Shipped, Designed, Reduced, Automated, Migrated, Scaled, Launched, Negotiated, etc.).
- Prefer concrete, specific phrasing over vague adjectives.
- Keep keyword density natural — include technologies and domain terms as they appear in the CV.
- Do not use first-person pronouns in bullets.
- Make section content copy-pastable plain text (no markdown, no emojis, no decorative punctuation).`

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

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const regenerate = new URL(req.url).searchParams.get('regenerate') === '1'

  const loaded = await loadGeneralCvContext(user.id)
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  const { cv, anthropicKey } = loaded.ctx

  if (!regenerate && cv.generalCv && isCvJson(cv.generalCv)) {
    return NextResponse.json({ generalCv: cv.generalCv, cached: true })
  }

  try {
    const generalCv = await generateGeneralCv(cv.rawText, anthropicKey)
    await db.update(cvs).set({ generalCv }).where(eq(cvs.id, cv.id))
    return NextResponse.json({ generalCv, cached: false })
  } catch (err) {
    console.error('[general-cv] failed:', err)
    return NextResponse.json({ error: 'General CV generation failed' }, { status: 500 })
  }
}
