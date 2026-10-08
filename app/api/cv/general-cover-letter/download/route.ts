import { NextResponse } from 'next/server'
import { Packer } from 'docx'
import { buildCoverLetterDocx, isCvJson, safeFilename, type CvJson } from '@/lib/cv-docx'
import { requireUser } from '@/lib/auth'
import { getActiveCv } from '@/lib/cv'

export async function GET() {
  const auth = await requireUser()
  if (auth.response) return auth.response
  const { user } = auth

  const cv = await getActiveCv(user.id)
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
