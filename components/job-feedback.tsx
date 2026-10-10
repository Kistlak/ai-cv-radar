'use client'

import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  FEEDBACK_REASON_LABELS,
  FEEDBACK_REASONS,
  type FeedbackReason,
  type FeedbackState,
  type FeedbackValue,
} from '@/lib/job-feedback'

interface JobFeedbackProps {
  jobId: string
  initialFeedback: number | null
  initialReason: string | null
}

function toState(feedback: number | null, reason: string | null): FeedbackState {
  const value: FeedbackValue = feedback === 1 || feedback === -1 ? feedback : null
  const known = (FEEDBACK_REASONS as readonly string[]).includes(reason ?? '')
  return { feedback: value, reason: value === -1 && known ? (reason as FeedbackReason) : null }
}

// Thumbs up/down on a job card. Saves optimistically and rolls back on error.
export function JobFeedback({ jobId, initialFeedback, initialReason }: JobFeedbackProps) {
  const [state, setState] = useState<FeedbackState>(() => toState(initialFeedback, initialReason))
  const [saving, setSaving] = useState(false)

  async function save(next: FeedbackState) {
    const previous = state
    setState(next)
    setSaving(true)
    try {
      const res = await fetch(`/api/jobs/${jobId}/feedback`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      if (!res.ok) throw new Error()
    } catch {
      setState(previous)
      toast.error("Couldn't save your feedback. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  // Clicking the active thumb clears the vote.
  const vote = (value: 1 | -1) =>
    save(state.feedback === value ? { feedback: null, reason: null } : { feedback: value, reason: null })

  // Clicking the selected reason clears it (the thumbs down stays).
  const pickReason = (reason: FeedbackReason) =>
    save({ feedback: -1, reason: state.reason === reason ? null : reason })

  const thumb = 'inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors disabled:opacity-50'

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="This match is good"
          aria-pressed={state.feedback === 1}
          disabled={saving}
          onClick={() => vote(1)}
          className={cn(
            thumb,
            state.feedback === 1
              ? 'bg-green-500/15 text-green-600 dark:text-green-400'
              : 'text-muted-foreground/60 hover:bg-muted hover:text-foreground'
          )}
        >
          <ThumbsUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="This match is not good"
          aria-pressed={state.feedback === -1}
          disabled={saving}
          onClick={() => vote(-1)}
          className={cn(
            thumb,
            state.feedback === -1
              ? 'bg-red-500/15 text-red-600 dark:text-red-400'
              : 'text-muted-foreground/60 hover:bg-muted hover:text-foreground'
          )}
        >
          <ThumbsDown className="h-3.5 w-3.5" />
        </button>
      </div>

      {state.feedback === -1 && (
        <div className="flex flex-wrap items-center justify-end gap-1" role="group" aria-label="Why isn't this a match?">
          <span className="text-[10px] text-muted-foreground/70">Why? (optional)</span>
          {FEEDBACK_REASONS.map((reason) => (
            <button
              key={reason}
              type="button"
              aria-pressed={state.reason === reason}
              disabled={saving}
              onClick={() => pickReason(reason)}
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] ring-1 transition-colors disabled:opacity-50',
                state.reason === reason
                  ? 'bg-red-500/10 text-red-600 ring-red-500/30 dark:text-red-400'
                  : 'text-muted-foreground ring-border/50 hover:bg-muted hover:text-foreground'
              )}
            >
              {FEEDBACK_REASON_LABELS[reason]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
