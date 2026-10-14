import type { RawJob } from './job-sources/types'

// How old a posting may be before it's dropped. Jobs without a date are kept.
const DEFAULT_MAX_AGE_DAYS = 30
const DAY_MS = 86_400_000

// JOB_MAX_AGE_DAYS: a whole number of days; 0 turns the filter off. Anything
// else invalid falls back to the default, like the usage limits do.
export function jobMaxAgeDays(env: Record<string, string | undefined> = process.env): number {
  const raw = env.JOB_MAX_AGE_DAYS
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_AGE_DAYS
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_MAX_AGE_DAYS
}

// Undated jobs (and dates a source sent that don't parse) are kept, and so are
// future dates (clock or timezone skew).
export function isFresh(job: Pick<RawJob, 'postedAt'>, now: number, maxDays: number): boolean {
  if (maxDays === 0 || !job.postedAt) return true
  const time = job.postedAt.getTime()
  if (Number.isNaN(time)) return true
  return now - time <= maxDays * DAY_MS
}

// Server-rendered, so "now" is the request time.
export function postedAgoLabel(postedAt: Date, now: number = Date.now()): string {
  const days = Math.floor((now - postedAt.getTime()) / DAY_MS)
  if (!(days >= 1)) return 'Posted today'
  return days === 1 ? 'Posted 1 day ago' : `Posted ${days} days ago`
}

// The source-side filters use the smallest bucket that still covers the
// window, so a source never drops a job isFresh would keep. Null: send nothing.
export function jsearchDatePosted(maxDays: number): string | null {
  if (maxDays === 0) return null
  if (maxDays <= 1) return 'today'
  if (maxDays <= 3) return '3days'
  if (maxDays <= 7) return 'week'
  if (maxDays <= 30) return 'month'
  return null
}

const GLASSDOOR_AGES = [1, 3, 7, 14, 30]

export function glassdoorFromAge(maxDays: number): number | null {
  if (maxDays === 0) return null
  return GLASSDOOR_AGES.find((age) => age >= maxDays) ?? null
}
