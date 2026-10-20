import { ApifyClient, type ActorRun } from 'apify-client'
import { guessCountry } from './country'
import type { RawJob, SearchParams } from './types'
import { glassdoorFromAge, jobMaxAgeDays } from '@/lib/freshness'
import { logger } from '@/lib/logger'

// Default actors - override via env vars if you want to swap any.
const LINKEDIN_ACTOR = process.env.APIFY_LINKEDIN_ACTOR || 'bebity/linkedin-jobs-scraper'
const INDEED_ACTOR = process.env.APIFY_INDEED_ACTOR || 'misceres/indeed-scraper'
const GLASSDOOR_ACTOR = process.env.APIFY_GLASSDOOR_ACTOR || 'bebity/glassdoor-jobs-scraper'

// Apify stops the run itself after this (and the billing with it), so a run
// can't outlive the route's maxDuration. A run that doesn't succeed returns no jobs.
const ACTOR_TIMEOUT_SECS = 150
// The wait is sliced so a cancelled search is noticed within a few seconds.
const WAIT_SLICE_SECS = 5
const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'])

// Starts an actor and waits for it to finish. If `signal` aborts first, the
// run is aborted on Apify (so it stops billing) and this throws.
export async function runActor(
  client: ApifyClient,
  actorId: string,
  input: unknown,
  signal?: AbortSignal
): Promise<ActorRun> {
  // Already cancelled: don't start (and pay for) a run.
  if (signal?.aborted) throw signal.reason ?? new Error('Aborted')
  let run = await client.actor(actorId).start(input, { timeout: ACTOR_TIMEOUT_SECS })
  // Slack over Apify's own timeout, in case its final status lags.
  const giveUpAt = Date.now() + (ACTOR_TIMEOUT_SECS + 10) * 1000

  while (!TERMINAL_STATUSES.has(run.status) && Date.now() < giveUpAt) {
    if (signal?.aborted) {
      await client.run(run.id).abort().catch(() => {})
      throw signal.reason ?? new Error('Aborted')
    }
    run = await client.run(run.id).waitForFinish({ waitSecs: WAIT_SLICE_SECS })
  }
  if (signal?.aborted && !TERMINAL_STATUSES.has(run.status)) {
    await client.run(run.id).abort().catch(() => {})
    throw signal.reason ?? new Error('Aborted')
  }
  return run
}

function parseDate(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !raw) return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d
}

// ───────────────────────────────────────────────────────────────
// LinkedIn (bebity/linkedin-jobs-scraper) - URL-based input
// ───────────────────────────────────────────────────────────────

interface BebityLinkedInJob {
  id?: string | number
  title?: string
  companyName?: string
  location?: string
  workType?: string
  salaryInfo?: string[] | string
  salary?: string
  postedAt?: string
  // The actor's current output: `publishedAt` is the date ("2026-08-29"),
  // `postedTime` only the displayed age ("3 days ago").
  publishedAt?: string
  description?: string
  descriptionHtml?: string
  link?: string
  jobUrl?: string
  applyUrl?: string
}

function buildLinkedInSearchUrl(params: SearchParams): string {
  const url = new URL('https://www.linkedin.com/jobs/search/')
  url.searchParams.set('keywords', params.query)
  if (params.remoteOnly) url.searchParams.set('f_WT', '2')
  else if (params.location) url.searchParams.set('location', params.location)
  url.searchParams.set('f_TPR', 'r604800') // last 7 days
  return url.toString()
}

export async function fetchApifyLinkedIn(
  params: SearchParams,
  apifyToken: string
): Promise<RawJob[]> {
  const client = new ApifyClient({ token: apifyToken })
  const searchUrl = buildLinkedInSearchUrl(params)
  logger.info({ event: 'job_source.apify_start', source: 'linkedin', actor: LINKEDIN_ACTOR, url: searchUrl })

  const run = await runActor(client, LINKEDIN_ACTOR, {
    startUrls: [{ url: searchUrl }],
    maxRowsPerUrl: 25,
    companyProfile: false,
  }, params.signal)
  logger.info({ event: 'job_source.apify_run', source: 'linkedin', runId: run.id, status: run.status })
  if (run.status !== 'SUCCEEDED') return []

  const { items } = await client.dataset(run.defaultDatasetId).listItems()
  logger.info({ event: 'job_source.apify_items', source: 'linkedin', items: items.length })

  const jobs: RawJob[] = []
  for (const raw of items) {
    const item = raw as BebityLinkedInJob
    const applyUrl = item.link ?? item.applyUrl ?? item.jobUrl
    if (!applyUrl || !item.title || !item.companyName) continue

    let salary: string | null = null
    if (Array.isArray(item.salaryInfo) && item.salaryInfo.length > 0)
      salary = item.salaryInfo.filter(Boolean).join(' · ')
    else if (typeof item.salaryInfo === 'string' && item.salaryInfo) salary = item.salaryInfo
    else if (item.salary) salary = item.salary

    jobs.push({
      source: 'linkedin',
      sourceJobId: String(item.id ?? applyUrl),
      title: item.title,
      company: item.companyName,
      location: item.location ?? null,
      remote: /remote/i.test(item.workType ?? '') || /remote/i.test(item.location ?? ''),
      salary,
      postedAt: parseDate(item.publishedAt) ?? parseDate(item.postedAt),
      description: item.description ?? item.descriptionHtml ?? null,
      applyUrl,
    })
  }
  return jobs
}

// ───────────────────────────────────────────────────────────────
// Indeed (misceres/indeed-scraper) - position + country input
// ───────────────────────────────────────────────────────────────

interface MisceresIndeedJob {
  id?: string
  positionName?: string
  company?: string
  companyName?: string
  location?: string
  salary?: string
  jobType?: string[]
  postedAt?: string
  postingDateParsed?: string
  description?: string
  descriptionHTML?: string
  url?: string
  externalApplyLink?: string
  isExpired?: boolean
}

export async function fetchApifyIndeed(
  params: SearchParams,
  apifyToken: string
): Promise<RawJob[]> {
  const client = new ApifyClient({ token: apifyToken })
  const country = guessCountry(params.location)
  const locationStr = params.remoteOnly ? 'Remote' : params.location ?? ''

  logger.info({ event: 'job_source.apify_start', source: 'indeed', actor: INDEED_ACTOR, query: params.query, country, location: locationStr })

  const run = await runActor(client, INDEED_ACTOR, {
    position: params.query,
    country,
    location: locationStr,
    maxItems: 25,
    parseCompanyDetails: false,
    saveOnlyUniqueItems: true,
    followApplyRedirects: false,
  }, params.signal)
  logger.info({ event: 'job_source.apify_run', source: 'indeed', runId: run.id, status: run.status })
  if (run.status !== 'SUCCEEDED') return []

  const { items } = await client.dataset(run.defaultDatasetId).listItems()
  logger.info({ event: 'job_source.apify_items', source: 'indeed', items: items.length })

  const jobs: RawJob[] = []
  for (const raw of items) {
    const item = raw as MisceresIndeedJob
    if (item.isExpired) continue
    const applyUrl = item.externalApplyLink ?? item.url
    const title = item.positionName
    const company = item.company ?? item.companyName
    if (!applyUrl || !title || !company) continue

    jobs.push({
      source: 'indeed',
      sourceJobId: String(item.id ?? applyUrl),
      title,
      company,
      location: item.location ?? null,
      remote: /remote/i.test(item.location ?? ''),
      salary: item.salary ?? null,
      postedAt: parseDate(item.postingDateParsed) ?? parseDate(item.postedAt),
      description: item.description ?? item.descriptionHTML ?? null,
      applyUrl,
    })
  }
  return jobs
}

// ───────────────────────────────────────────────────────────────
// Glassdoor (bebity/glassdoor-jobs-scraper) - URL-based input
// ───────────────────────────────────────────────────────────────

interface BebityGlassdoorJob {
  id?: string | number
  jobTitle?: string
  title?: string
  companyName?: string
  employer?: string
  location?: string
  salary?: string
  salaryEstimate?: string
  postedAt?: string
  description?: string
  jobDescription?: string
  jobLink?: string
  url?: string
  // The actor's current output is flat snake_case rows.
  job_id?: string | number
  job_title?: string
  company_name?: string
  job_url?: string
  job_apply_url?: string
  job_posted_date?: string
  job_expired?: boolean
  job_remote?: boolean
  job_description?: string
  job_location?: { unknown?: string }
  job_salary?: GlassdoorSalary
}

interface GlassdoorSalary {
  min?: number
  max?: number
  currency?: string
  currency_symbol?: string
  pay_period?: string
  estimated?: boolean
}

const GLASSDOOR_PAY_PERIODS: Record<string, string> = {
  hourly: 'per hour',
  daily: 'per day',
  weekly: 'per week',
  monthly: 'per month',
  annual: 'per year',
}

// "$70k–$90k per year", "$73 per hour (estimate)".
function formatGlassdoorSalary(s: GlassdoorSalary | undefined): string | null {
  if (!s || (!s.min && !s.max)) return null
  const symbol = s.currency_symbol ?? (s.currency ? `${s.currency} ` : '')
  const amount = (n: number) => (n >= 1000 ? `${symbol}${Math.round(n / 1000)}k` : `${symbol}${n}`)
  let text: string
  if (s.min && s.max && s.min !== s.max) text = `${amount(s.min)}–${amount(s.max)}`
  else text = amount((s.min || s.max)!)
  const period = GLASSDOOR_PAY_PERIODS[s.pay_period?.toLowerCase() ?? '']
  if (period) text += ` ${period}`
  if (s.estimated) text += ' (estimate)'
  return text
}

function buildGlassdoorSearchUrl(params: SearchParams): string {
  const url = new URL('https://www.glassdoor.com/Job/jobs.htm')
  url.searchParams.set('sc.keyword', params.query)
  url.searchParams.set('typedKeyword', params.query)
  if (params.remoteOnly || !params.location) url.searchParams.set('locName', 'Remote')
  else url.searchParams.set('locName', params.location)
  const fromAge = glassdoorFromAge(jobMaxAgeDays())
  if (fromAge) url.searchParams.set('fromAge', String(fromAge))
  return url.toString()
}

export async function fetchApifyGlassdoor(
  params: SearchParams,
  apifyToken: string
): Promise<RawJob[]> {
  const client = new ApifyClient({ token: apifyToken })
  const searchUrl = buildGlassdoorSearchUrl(params)
  logger.info({ event: 'job_source.apify_start', source: 'glassdoor', actor: GLASSDOOR_ACTOR, url: searchUrl })

  const run = await runActor(client, GLASSDOOR_ACTOR, {
    searchUrls: [searchUrl],
    maxItems: 25,
  }, params.signal)
  logger.info({ event: 'job_source.apify_run', source: 'glassdoor', runId: run.id, status: run.status })
  if (run.status !== 'SUCCEEDED') return []

  const { items } = await client.dataset(run.defaultDatasetId).listItems()
  logger.info({ event: 'job_source.apify_items', source: 'glassdoor', items: items.length })

  const jobs: RawJob[] = []
  for (const raw of items) {
    const item = raw as BebityGlassdoorJob
    if (item.job_expired) continue
    const applyUrl = item.job_apply_url ?? item.job_url ?? item.jobLink ?? item.url
    const title = item.job_title ?? item.jobTitle ?? item.title
    const company = item.company_name ?? item.companyName ?? item.employer
    if (!applyUrl || !title || !company) continue
    const location = item.job_location?.unknown ?? item.location ?? null

    jobs.push({
      source: 'glassdoor',
      sourceJobId: String(item.job_id ?? item.id ?? applyUrl),
      title,
      company,
      location,
      remote: item.job_remote === true || /remote/i.test(location ?? ''),
      salary: formatGlassdoorSalary(item.job_salary) ?? item.salary ?? item.salaryEstimate ?? null,
      postedAt: parseDate(item.job_posted_date) ?? parseDate(item.postedAt),
      description: item.job_description ?? item.description ?? item.jobDescription ?? null,
      applyUrl,
    })
  }
  return jobs
}
