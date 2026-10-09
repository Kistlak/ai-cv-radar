import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { cvs } from '@/db/schema'
import { isCvJson, parseCvJson, type CvJson } from '@/lib/cv-docx'
import { extractJson } from '@/lib/ai/parse-json'
import { loadGeneralCvContext } from '@/lib/general-cv-helpers'
import type { AiClient } from '@/lib/ai/provider'
import { consumeQuota, quotaExceededResponse } from '@/lib/usage-limits'
import { requireUser } from '@/lib/auth'
import { logger } from '@/lib/logger'

async function generateGeneralCv(cvText: string, ai: AiClient): Promise<CvJson> {
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

  const text = await ai.complete({ tier: 'smart', maxTokens: 3500, prompt, json: true })
  const parsed = parseCvJson(extractJson(text, 'object'))
  if (!parsed) throw new Error('Response did not match expected CV shape')
  return parsed
}

export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (auth.response) return auth.response
  const { user } = auth

  const regenerate = new URL(req.url).searchParams.get('regenerate') === '1'

  const loaded = await loadGeneralCvContext(user.id)
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  const { cv, ai, usingFallback } = loaded.ctx

  if (!regenerate && cv.generalCv && isCvJson(cv.generalCv)) {
    return NextResponse.json({ generalCv: cv.generalCv, cached: true })
  }

  if (usingFallback) {
    const quota = await consumeQuota(user.id, 'ai_generation')
    if (!quota.ok) return quotaExceededResponse(quota)
  }

  try {
    const generalCv = await generateGeneralCv(cv.rawText, ai)
    await db.update(cvs).set({ generalCv }).where(eq(cvs.id, cv.id))
    return NextResponse.json({ generalCv, cached: false })
  } catch (err) {
    logger.error({ event: 'ai_route.generation_failed', route: 'general-cv', err })
    return NextResponse.json({ error: 'General CV generation failed' }, { status: 500 })
  }
}
