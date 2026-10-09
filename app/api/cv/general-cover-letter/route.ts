import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { cvs } from '@/db/schema'
import { loadGeneralCvContext } from '@/lib/general-cv-helpers'
import type { AiClient } from '@/lib/ai/provider'
import { consumeQuota, quotaExceededResponse } from '@/lib/usage-limits'
import { requireUser } from '@/lib/auth'
import { logger } from '@/lib/logger'

async function generateGeneralCoverLetter(cvText: string, ai: AiClient): Promise<string> {
  const prompt = `Write a polished, reusable general cover letter for this candidate. The candidate will customize it for specific jobs by replacing the bracketed placeholders, so keep it strong but adaptable.

CANDIDATE CV:
${cvText.slice(0, 6000)}

Rules:
- 300-380 words, 3-4 short paragraphs.
- First paragraph: open with a hook tied to the candidate's strongest achievement or years in their domain. State they are applying for [Role Title] at [Company Name].
- Middle paragraph(s): highlight 2-3 concrete strengths drawn directly from the CV. Use specific projects, technologies, metrics, or outcomes from the CV — do not invent any.
- Closing paragraph: short, confident call to action. Mention looking forward to discussing how they can contribute to [Company Name].
- Use these exact placeholders where customization is needed: [Company Name], [Role Title]. Use "Dear Hiring Team," as the salutation (no placeholder name).
- No other placeholders. Do NOT use [Your Name], [Date], [Address], or similar.
- No markdown. No bullet lists. No headings. No postal address block. Plain prose only.
- Do not claim skills, certifications, employers, or metrics not present in the CV.
- Return ONLY the letter text, starting with the salutation. No preamble, no notes.`

  const text = await ai.complete({ tier: 'smart', maxTokens: 1500, prompt })
  return text.trim()
}

export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (auth.response) return auth.response
  const { user } = auth

  const regenerate = new URL(req.url).searchParams.get('regenerate') === '1'

  const loaded = await loadGeneralCvContext(user.id)
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  const { cv, ai, usingFallback } = loaded.ctx

  if (!regenerate && cv.generalCoverLetter) {
    return NextResponse.json({ coverLetter: cv.generalCoverLetter, cached: true })
  }

  if (usingFallback) {
    const quota = await consumeQuota(user.id, 'ai_generation')
    if (!quota.ok) return quotaExceededResponse(quota)
  }

  try {
    const coverLetter = await generateGeneralCoverLetter(cv.rawText, ai)
    await db.update(cvs).set({ generalCoverLetter: coverLetter }).where(eq(cvs.id, cv.id))
    return NextResponse.json({ coverLetter, cached: false })
  } catch (err) {
    logger.error({ event: 'ai_route.generation_failed', route: 'general-cover-letter', err })
    return NextResponse.json({ error: 'Cover letter generation failed' }, { status: 500 })
  }
}
