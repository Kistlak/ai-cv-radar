import { NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { Packer } from 'docx'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { cvs } from '@/db/schema'
import { buildCoverLetterDocx, isCvJson, safeFilename, type CvJson } from '@/lib/cv-docx'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [cv] = await db
    .select()
    .from(cvs)
    .where(eq(cvs.userId, user.id))
    .orderBy(desc(cvs.createdAt))
    .limit(1)
  if (!cv) return NextResponse.json({ error: 'No CV on file' }, { status: 404 })
  if (!cv.generalCoverLetter) {
    return NextResponse.json({ error: 'Generate your cover letter first' }, { status: 400 })
  }

  // Prefer the polished general CV for name + contact; fall back to the raw structured CV.
  let name = 'Cover_Letter'
  let contact: CvJson['contact'] = {}
  if (cv.generalCv && isCvJson(cv.generalCv)) {
    name = cv.generalCv.name
    contact = cv.generalCv.contact
  } else if (cv.structured && typeof cv.structured === 'object') {
    const s = cv.structured as Record<string, unknown>
    if (typeof s.name === 'string') name = s.name
    if (typeof s.email === 'string') contact.email = s.email
    if (typeof s.location === 'string') contact.location = s.location
  }

  const doc = buildCoverLetterDocx({ letter: cv.generalCoverLetter, name, contact })
  const buffer = await Packer.toBuffer(doc)
  const filename = safeFilename([name, 'Cover_Letter']) + '.docx'

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
