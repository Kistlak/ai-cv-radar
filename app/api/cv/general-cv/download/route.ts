import { NextRequest, NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { Packer } from 'docx'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { cvs } from '@/db/schema'
import { buildCvDocx, isCvJson, safeFilename } from '@/lib/cv-docx'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const withPhoto = new URL(req.url).searchParams.get('photo') === '1'

  const [cv] = await db
    .select()
    .from(cvs)
    .where(eq(cvs.userId, user.id))
    .orderBy(desc(cvs.createdAt))
    .limit(1)
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
