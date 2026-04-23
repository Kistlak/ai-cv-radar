'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2 } from 'lucide-react'
import { CancelSearchButton } from '@/components/cancel-search-button'
import type { SearchProgress, SearchStage } from '@/lib/search-progress'

interface SearchPollerProps {
  searchId: string
}

const STAGE_ORDER: SearchStage[] = [
  'starting',
  'deriving-queries',
  'fetching',
  'scoring',
  'persisting',
]

function stageIndex(stage: SearchStage | undefined): number {
  if (!stage) return 0
  const i = STAGE_ORDER.indexOf(stage)
  return i < 0 ? 0 : i
}

export default function SearchPoller({ searchId }: SearchPollerProps) {
  const router = useRouter()
  const [progress, setProgress] = useState<SearchProgress | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/search?id=${searchId}`)
        if (!res.ok) return
        const data = await res.json()
        if (data.search?.progress) setProgress(data.search.progress as SearchProgress)
        if (data.search?.status !== 'running') {
          if (intervalRef.current) clearInterval(intervalRef.current)
          router.refresh()
        }
      } catch {
        // network error — keep polling
      }
    }
    void poll()
    intervalRef.current = setInterval(poll, 2000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [searchId, router])

  const currentStage = progress?.stage ?? 'starting'
  const currentIdx = stageIndex(currentStage)

  const steps: Array<{ key: SearchStage; label: string; detail?: string }> = [
    {
      key: 'deriving-queries',
      label: 'Deriving queries from CV',
      detail: progress?.queries?.length
        ? progress.queries.join(' · ')
        : undefined,
    },
    {
      key: 'fetching',
      label: 'Fetching jobs',
      detail: fetchingDetail(progress),
    },
    {
      key: 'scoring',
      label: 'Scoring matches against your CV',
      detail: progress?.totalJobs ? `${progress.totalJobs} jobs to rank` : undefined,
    },
    {
      key: 'persisting',
      label: 'Saving results',
      detail: progress?.scoredJobs != null ? `${progress.scoredJobs} jobs kept` : undefined,
    },
  ]

  return (
    <div className="glass rounded-2xl p-8 sm:p-10">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600/10 via-fuchsia-500/10 to-pink-500/10 ring-1 ring-violet-500/20">
          <Loader2 className="h-5 w-5 text-violet-500 animate-spin" />
        </div>
        <div>
          <p className="font-semibold">Finding and ranking jobs…</p>
          <p className="text-xs text-muted-foreground">
            Typically 30–90 seconds. You can leave this page — we&apos;ll keep going.
          </p>
        </div>
      </div>

      <ul className="mt-6 space-y-3">
        {steps.map((step) => {
          const idx = stageIndex(step.key)
          const isDone = idx < currentIdx
          const isActive = idx === currentIdx
          return (
            <li
              key={step.key}
              className="flex items-start gap-3 text-sm"
            >
              <span
                className={
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-1 ' +
                  (isDone
                    ? 'bg-green-500/10 ring-green-500/30 text-green-600 dark:text-green-400'
                    : isActive
                    ? 'bg-violet-500/10 ring-violet-500/30 text-violet-500'
                    : 'bg-muted ring-border/40 text-muted-foreground')
                }
              >
                {isDone ? (
                  <Check className="h-3 w-3" />
                ) : isActive ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                )}
              </span>
              <span className="min-w-0">
                <span
                  className={
                    isActive
                      ? 'font-medium text-foreground'
                      : isDone
                      ? 'text-muted-foreground'
                      : 'text-muted-foreground/60'
                  }
                >
                  {step.label}
                </span>
                {step.detail && (
                  <span className="mt-0.5 block text-xs text-muted-foreground/80">
                    {step.detail}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ul>

      <div className="mt-6 flex justify-center">
        <CancelSearchButton searchId={searchId} />
      </div>
    </div>
  )
}

function fetchingDetail(progress: SearchProgress | null): string | undefined {
  if (!progress) return undefined
  const parts: string[] = []
  if (progress.cheapSources?.length) {
    const label = progress.cheapDone
      ? `Free sources: ${progress.cheapCount ?? 0} jobs`
      : `Free sources: ${progress.cheapSources.join(', ')}`
    parts.push(label)
  }
  if (progress.agentic) {
    if (progress.agenticDone) {
      parts.push(
        `Agent: ${progress.agenticCount ?? 0} jobs` +
          (progress.agenticMcpCalls ? ` (${progress.agenticMcpCalls} tool calls)` : '')
      )
    } else {
      parts.push(
        progress.agenticMcpCalls
          ? `Agent working · ${progress.agenticMcpCalls} tool calls so far`
          : 'Agent searching LinkedIn / Indeed / Glassdoor'
      )
    }
  }
  return parts.length > 0 ? parts.join(' · ') : undefined
}
