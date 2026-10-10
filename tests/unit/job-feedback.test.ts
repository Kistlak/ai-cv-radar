import { describe, expect, it } from 'vitest'
import { FeedbackRequestSchema, normalizeFeedback } from '@/lib/job-feedback'

describe('FeedbackRequestSchema', () => {
  it('accepts a thumbs up, a thumbs down and a clear', () => {
    expect(FeedbackRequestSchema.safeParse({ feedback: 1 }).success).toBe(true)
    expect(FeedbackRequestSchema.safeParse({ feedback: -1, reason: 'wrong_level' }).success).toBe(true)
    expect(FeedbackRequestSchema.safeParse({ feedback: null, reason: null }).success).toBe(true)
  })

  it('rejects other values and unknown reasons', () => {
    for (const body of [
      { feedback: 0 },
      { feedback: 2 },
      { feedback: '1' },
      {},
      { feedback: -1, reason: 'too_far' },
      null,
    ]) {
      expect(FeedbackRequestSchema.safeParse(body).success).toBe(false)
    }
  })
})

describe('normalizeFeedback', () => {
  it('keeps the reason only with a thumbs down', () => {
    expect(normalizeFeedback({ feedback: -1, reason: 'expired' })).toEqual({ feedback: -1, reason: 'expired' })
    expect(normalizeFeedback({ feedback: 1, reason: 'expired' })).toEqual({ feedback: 1, reason: null })
    expect(normalizeFeedback({ feedback: null, reason: 'expired' })).toEqual({ feedback: null, reason: null })
  })

  it('treats a missing reason as none', () => {
    expect(normalizeFeedback({ feedback: -1 })).toEqual({ feedback: -1, reason: null })
  })
})
