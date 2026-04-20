import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { searches } from '@/db/schema'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const [search] = await db
    .select()
    .from(searches)
    .where(and(eq(searches.id, id), eq(searches.userId, user.id)))
    .limit(1)

  if (!search) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (search.status !== 'running') {
    return NextResponse.json({ error: `Search is already ${search.status}` }, { status: 409 })
  }

  await db
    .update(searches)
    .set({ status: 'cancelled', completedAt: new Date() })
    .where(eq(searches.id, id))

  return NextResponse.json({ ok: true })
}
