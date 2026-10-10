import { z } from 'zod'

// Thumbs up/down on a job result (job_results.feedback). A reason is optional
// and only kept with a thumbs down. The values are enforced by the
// job_results_feedback_*_check constraints (20261012_job_results_feedback.sql).

export const FEEDBACK_REASONS = [
  'wrong_field',
  'wrong_level',
  'wrong_location',
  'missing_requirement',
  'expired',
  'other',
] as const
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number]

export const FEEDBACK_REASON_LABELS: Record<FeedbackReason, string> = {
  wrong_field: 'Wrong field',
  wrong_level: 'Wrong level',
  wrong_location: 'Wrong location',
  missing_requirement: 'Missing a requirement',
  expired: 'Expired / closed',
  other: 'Other',
}

// 1 = good match, -1 = not a match, null = clear the vote.
export type FeedbackValue = 1 | -1 | null

export const FeedbackRequestSchema = z.object({
  feedback: z.union([z.literal(1), z.literal(-1), z.null()]),
  reason: z.enum(FEEDBACK_REASONS).nullish(),
})
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>

export interface FeedbackState {
  feedback: FeedbackValue
  reason: FeedbackReason | null
}

// A reason only makes sense with a thumbs down; anything else drops it.
export function normalizeFeedback(input: FeedbackRequest): FeedbackState {
  return {
    feedback: input.feedback,
    reason: input.feedback === -1 ? (input.reason ?? null) : null,
  }
}
