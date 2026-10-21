import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { getCvFile } from '@/lib/cv-retention'

// Opens the PDF the user uploaded, inline in the browser. The bytes are
// streamed from storage rather than redirected to a signed URL, so the file
// stays on our domain and only ever reaches its owner. CVs are capped at 4 MB
// (lib/cv-upload.ts), inside Vercel's 4.5 MB response limit; raising that cap
// past it would need a signed URL instead.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser()
  if (auth.response) return auth.response
  const { user, supabase } = auth

  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'CV not found' }, { status: 404 })
  }

  const result = await getCvFile(user.id, id, supabase)
  if (!result.ok) {
    if (result.reason === 'not_found') {
      return NextResponse.json({ error: 'CV not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Could not load the CV file. Please try again.' }, { status: 500 })
  }

  const filename = `CV-${result.createdAt.toISOString().slice(0, 10)}.pdf`
  return new NextResponse(result.bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
