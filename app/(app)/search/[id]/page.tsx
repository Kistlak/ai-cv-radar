import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { searches, jobResults } from '@/db/schema'
import { and, eq, desc } from 'drizzle-orm'
import {
  ArrowLeft, Clock, MapPin, ExternalLink, Wifi, Building2,
  Sparkles, AlertCircle, BadgeCheck, Ban,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import SearchPoller from '@/components/search-poller'
import { JobActions } from '@/components/job-actions'

export default async function SearchResultsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [search] = await db
    .select()
    .from(searches)
    .where(and(eq(searches.id, id), eq(searches.userId, user.id)))
    .limit(1)

  if (!search) notFound()

  const jobs =
    search.status === 'complete'
      ? await db
          .select()
          .from(jobResults)
          .where(eq(jobResults.searchId, id))
          .orderBy(desc(jobResults.matchScore))
      : []

  return (
    <div className="space-y-8 animate-in-fade">
      <div className="flex items-start gap-4">
        <Link
          href="/search"
          className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          New search
        </Link>
      </div>

      <div>
        <p className="text-sm text-muted-foreground">Search results</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
          <span className="text-gradient">{search.query}</span>
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          {search.location && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              {search.location}
            </span>
          )}
          {search.remoteOnly && (
            <span className="inline-flex items-center gap-1.5">
              <Wifi className="h-3.5 w-3.5" />
              Remote only
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            {new Date(search.createdAt).toLocaleString()}
          </span>
          <StatusBadge status={search.status} />
        </div>
      </div>

      {search.status === 'running' && <SearchPoller searchId={id} />}

      {search.status === 'cancelled' && (
        <div className="glass rounded-2xl p-8 ring-1 ring-border/40">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-border/40">
              <Ban className="h-4 w-4" />
            </div>
            <div>
              <p className="font-semibold text-sm">Search cancelled</p>
              <p className="mt-1 text-xs text-muted-foreground">
                You stopped this search before it finished. Start a new one any time.
              </p>
            </div>
          </div>
        </div>
      )}

      {search.status === 'failed' && (
        <div className="glass rounded-2xl p-8 ring-1 ring-destructive/20">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive ring-1 ring-destructive/20">
              <AlertCircle className="h-4 w-4" />
            </div>
            <div>
              <p className="font-semibold text-sm">Search failed</p>
              <p className="mt-1 text-xs text-muted-foreground">{search.error ?? 'An unknown error occurred.'}</p>
            </div>
          </div>
        </div>
      )}

      {search.status === 'complete' && jobs.length === 0 && (
        <div className="glass rounded-2xl p-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600/10 via-fuchsia-500/10 to-pink-500/10 ring-1 ring-violet-500/20">
            <Sparkles className="h-6 w-6 text-violet-500" />
          </div>
          <p className="mt-4 font-semibold">No jobs found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Try broadening your search terms or enabling more sources.
          </p>
        </div>
      )}

      {jobs.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{jobs.length}</span> jobs ranked by match score
            </p>
          </div>
          <div className="space-y-3">
            {jobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

type Job = typeof jobResults.$inferSelect

function JobCard({ job }: { job: Job }) {
  const score = job.matchScore ?? 0
  const scoreColor =
    score >= 75 ? 'text-green-600 dark:text-green-400' :
    score >= 50 ? 'text-amber-600 dark:text-amber-400' :
    'text-muted-foreground'
  const scoreBg =
    score >= 75 ? 'bg-green-500/10 ring-green-500/20' :
    score >= 50 ? 'bg-amber-500/10 ring-amber-500/20' :
    'bg-muted/50 ring-border/40'

  return (
    <div className="glass rounded-2xl p-5 transition-all hover:shadow-lg hover:-translate-y-0.5 group">
      <div className="flex items-start gap-4">
        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 font-bold text-sm', scoreBg, scoreColor)}>
          {score}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-semibold leading-snug truncate">{job.title}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-3 w-3" />
                  {job.company}
                </span>
                {job.location && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {job.location}
                  </span>
                )}
                {job.remote && (
                  <span className="inline-flex items-center gap-1 text-violet-600 dark:text-violet-300">
                    <Wifi className="h-3 w-3" />
                    Remote
                  </span>
                )}
                {job.salary && (
                  <span className="font-medium text-foreground">{job.salary}</span>
                )}
              </div>
            </div>

            <a
              href={job.applyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all',
                'bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-500 text-white',
                'shadow-md shadow-violet-500/20 hover:shadow-violet-500/40 hover:scale-105 active:scale-100'
              )}
            >
              Apply
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          {job.matchReason && (
            <div className="mt-3 flex items-start gap-1.5 rounded-lg bg-violet-500/5 ring-1 ring-violet-500/10 px-3 py-2">
              <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" />
              <p className="text-xs text-muted-foreground leading-relaxed">{job.matchReason}</p>
            </div>
          )}

          <JobActions
            jobId={job.id}
            jobTitle={job.title}
            company={job.company}
            applyUrl={job.applyUrl}
          />

          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60 font-medium">{job.source}</span>
            {job.postedAt && (
              <span className="text-[10px] text-muted-foreground/60">
                {new Date(job.postedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, string> = {
    complete: 'bg-green-500/10 text-green-600 dark:text-green-400 ring-green-500/20',
    running: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20',
    failed: 'bg-red-500/10 text-red-600 dark:text-red-400 ring-red-500/20',
    cancelled: 'bg-muted text-muted-foreground ring-border/40',
  }
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1', config[status] ?? 'bg-muted text-muted-foreground')}>
      {status}
    </span>
  )
}
