import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { deleteCv } from '@/lib/cv-retention'

// Deletes a previous (non-active) CV, its stored PDF, and its searches.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser()
  if (auth.response) return auth.response
  const { user, supabase } = auth

  const { id } = await params
  const result = await deleteCv(user.id, id, supabase)

  if (result.ok) return NextResponse.json({ deletedSearches: result.deletedSearches })
  if (result.reason === 'not_found') {
    return NextResponse.json({ error: 'CV not found' }, { status: 404 })
  }
  if (result.reason === 'active') {
    return NextResponse.json(
      { error: 'This is your current CV. Upload a new CV before deleting this one.' },
      { status: 409 }
    )
  }
  return NextResponse.json({ error: 'Could not delete the CV file. Please try again.' }, { status: 500 })
}
