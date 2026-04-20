import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { cvs } from '@/db/schema'
import { loadGeneralCvContext } from '@/lib/general-cv-helpers'

async function generateGeneralCoverLetter(
  cvText: string,
  anthropicKey: string
): Promise<string> {
  const client = new Anthropic({ apiKey: anthropicKey })

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

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  })

  const content = message.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type')
  return content.text.trim()
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const regenerate = new URL(req.url).searchParams.get('regenerate') === '1'

  const loaded = await loadGeneralCvContext(user.id)
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  const { cv, anthropicKey } = loaded.ctx

  if (!regenerate && cv.generalCoverLetter) {
    return NextResponse.json({ coverLetter: cv.generalCoverLetter, cached: true })
  }

  try {
    const coverLetter = await generateGeneralCoverLetter(cv.rawText, anthropicKey)
    await db.update(cvs).set({ generalCoverLetter: coverLetter }).where(eq(cvs.id, cv.id))
    return NextResponse.json({ coverLetter, cached: false })
  } catch (err) {
    console.error('[general-cover-letter] failed:', err)
    return NextResponse.json({ error: 'Cover letter generation failed' }, { status: 500 })
  }
}
