import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { Packer } from 'docx'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { jobResults, searches } from '@/db/schema'
import { buildCvDocx, isCvJson, safeFilename } from '@/lib/cv-docx'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const withPhoto = new URL(req.url).searchParams.get('photo') === '1'

  const [row] = await db
    .select({ job: jobResults })
    .from(jobResults)
    .innerJoin(searches, eq(jobResults.searchId, searches.id))
    .where(and(eq(jobResults.id, id), eq(searches.userId, user.id)))
    .limit(1)

  if (!row) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  const cv = row.job.tailoredCv
  if (!cv || !isCvJson(cv)) {
    return NextResponse.json({ error: 'No tailored CV generated yet' }, { status: 400 })
  }

  const doc = buildCvDocx(cv, withPhoto)
  const buffer = await Packer.toBuffer(doc)
  const filename = safeFilename([cv.name, row.job.company, 'CV']) + '.docx'

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
