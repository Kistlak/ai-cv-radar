import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import { jobResults, searches } from '@/db/schema'
import { requireUser } from '@/lib/auth'
import { FeedbackRequestSchema, normalizeFeedback } from '@/lib/job-feedback'
import { logger } from '@/lib/logger'

// Sets or clears the signed-in user's thumbs up/down on one of their jobs.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser()
  if (auth.response) return auth.response
  const { user } = auth

  const { id } = await params
  // A malformed id can't be a job; answer like any other missing job.
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => null)
  const parsed = FeedbackRequestSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  const { feedback, reason } = normalizeFeedback(parsed.data)

  // Ownership is part of the update itself: only a job in one of the user's
  // searches matches, so another user's job gets the same 404 as a missing one.
  const [row] = await db
    .update(jobResults)
    .set({
      feedback,
      feedbackReason: reason,
      feedbackAt: feedback === null ? null : sql`now()`,
    })
    .where(
      and(
        eq(jobResults.id, id),
        inArray(
          jobResults.searchId,
          db.select({ id: searches.id }).from(searches).where(eq(searches.userId, user.id))
        )
      )
    )
    .returning({ matchScore: jobResults.matchScore, source: jobResults.source })

  if (!row) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  logger.info({
    event: 'job_feedback.set',
    userId: user.id,
    jobId: id,
    feedback,
    reason,
    matchScore: row.matchScore,
    source: row.source,
  })
  return NextResponse.json({ feedback, reason })
}
