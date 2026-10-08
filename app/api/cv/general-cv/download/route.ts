import { NextRequest, NextResponse } from 'next/server'
import { Packer } from 'docx'
import { buildCvDocx, isCvJson, safeFilename } from '@/lib/cv-docx'
import { requireUser } from '@/lib/auth'
import { getActiveCv } from '@/lib/cv'

export async function GET(req: NextRequest) {
  const auth = await requireUser()
  if (auth.response) return auth.response
  const { user } = auth

  const withPhoto = new URL(req.url).searchParams.get('photo') === '1'

  const cv = await getActiveCv(user.id)
  if (!cv) return NextResponse.json({ error: 'No CV on file' }, { status: 404 })
  const general = cv.generalCv
  if (!general || !isCvJson(general)) {
    return NextResponse.json({ error: 'Generate your CV first' }, { status: 400 })
  }

  const doc = buildCvDocx(general, withPhoto)
  const buffer = await Packer.toBuffer(doc)
  const filename = safeFilename([general.name, 'CV']) + '.docx'

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
