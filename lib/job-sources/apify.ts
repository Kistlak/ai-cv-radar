import { ApifyClient } from 'apify-client'
import type { RawJob, SearchParams } from './types'

// Default actors - override via env vars if you want to swap any.
const LINKEDIN_ACTOR = process.env.APIFY_LINKEDIN_ACTOR || 'bebity/linkedin-jobs-scraper'
const INDEED_ACTOR = process.env.APIFY_INDEED_ACTOR || 'misceres/indeed-scraper'
const GLASSDOOR_ACTOR = process.env.APIFY_GLASSDOOR_ACTOR || 'bebity/glassdoor-jobs-scraper'

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
  postedAt?: string
  description?: string
  descriptionHtml?: string
  link?: string
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
  console.log(`[apify-linkedin] actor=${LINKEDIN_ACTOR} url=${searchUrl}`)

  const run = await client.actor(LINKEDIN_ACTOR).call({
    urls: [searchUrl],
    count: 25,
    scrapeCompany: false,
  })
  console.log(`[apify-linkedin] run ${run.id} status=${run.status}`)
  if (run.status !== 'SUCCEEDED') return []

  const { items } = await client.dataset(run.defaultDatasetId).listItems()
  console.log(`[apify-linkedin] got ${items.length} items`)

  const jobs: RawJob[] = []
  for (const raw of items) {
    const item = raw as BebityLinkedInJob
    const applyUrl = item.link ?? item.applyUrl
    if (!applyUrl || !item.title || !item.companyName) continue

    let salary: string | null = null
    if (Array.isArray(item.salaryInfo) && item.salaryInfo.length > 0)
      salary = item.salaryInfo.filter(Boolean).join(' · ')
    else if (typeof item.salaryInfo === 'string' && item.salaryInfo) salary = item.salaryInfo

    jobs.push({
      source: 'linkedin',
      sourceJobId: String(item.id ?? applyUrl),
      title: item.title,
      company: item.companyName,
      location: item.location ?? null,
      remote: /remote/i.test(item.workType ?? '') || /remote/i.test(item.location ?? ''),
      salary,
      postedAt: parseDate(item.postedAt),
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
  description?: string
  descriptionHTML?: string
  url?: string
  externalApplyLink?: string
  isExpired?: boolean
}

function guessCountry(location?: string): string {
  if (!location) return 'us'
  const loc = location.toLowerCase()
  if (/\b(uk|united kingdom|england|london|manchester|scotland|wales)\b/.test(loc)) return 'gb'
  if (/\b(canada|toronto|vancouver|montreal)\b/.test(loc)) return 'ca'
  if (/\b(australia|sydney|melbourne)\b/.test(loc)) return 'au'
  if (/\b(india|bangalore|mumbai|delhi|hyderabad)\b/.test(loc)) return 'in'
  if (/\b(germany|berlin|munich)\b/.test(loc)) return 'de'
  if (/\b(france|paris)\b/.test(loc)) return 'fr'
  return 'us'
}

export async function fetchApifyIndeed(
  params: SearchParams,
  apifyToken: string
): Promise<RawJob[]> {
  const client = new ApifyClient({ token: apifyToken })
  const country = guessCountry(params.location)
  const locationStr = params.remoteOnly ? 'Remote' : params.location ?? ''

  console.log(`[apify-indeed] actor=${INDEED_ACTOR} position="${params.query}" country=${country} location="${locationStr}"`)

  const run = await client.actor(INDEED_ACTOR).call({
    position: params.query,
    country,
    location: locationStr,
    maxItems: 25,
    parseCompanyDetails: false,
    saveOnlyUniqueItems: true,
    followApplyRedirects: false,
  })
  console.log(`[apify-indeed] run ${run.id} status=${run.status}`)
  if (run.status !== 'SUCCEEDED') return []

  const { items } = await client.dataset(run.defaultDatasetId).listItems()
  console.log(`[apify-indeed] got ${items.length} items`)

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
      postedAt: parseDate(item.postedAt),
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
}

function buildGlassdoorSearchUrl(params: SearchParams): string {
  const url = new URL('https://www.glassdoor.com/Job/jobs.htm')
  url.searchParams.set('sc.keyword', params.query)
  url.searchParams.set('typedKeyword', params.query)
  if (params.remoteOnly || !params.location) url.searchParams.set('locName', 'Remote')
  else url.searchParams.set('locName', params.location)
  return url.toString()
}

export async function fetchApifyGlassdoor(
  params: SearchParams,
  apifyToken: string
): Promise<RawJob[]> {
  const client = new ApifyClient({ token: apifyToken })
  const searchUrl = buildGlassdoorSearchUrl(params)
  console.log(`[apify-glassdoor] actor=${GLASSDOOR_ACTOR} url=${searchUrl}`)

  const run = await client.actor(GLASSDOOR_ACTOR).call({
    searchUrls: [searchUrl],
    maxResults: 25,
  })
  console.log(`[apify-glassdoor] run ${run.id} status=${run.status}`)
  if (run.status !== 'SUCCEEDED') return []

  const { items } = await client.dataset(run.defaultDatasetId).listItems()
  console.log(`[apify-glassdoor] got ${items.length} items`)

  const jobs: RawJob[] = []
  for (const raw of items) {
    const item = raw as BebityGlassdoorJob
    const applyUrl = item.jobLink ?? item.url
    const title = item.jobTitle ?? item.title
    const company = item.companyName ?? item.employer
    if (!applyUrl || !title || !company) continue

    jobs.push({
      source: 'glassdoor',
      sourceJobId: String(item.id ?? applyUrl),
      title,
      company,
      location: item.location ?? null,
      remote: /remote/i.test(item.location ?? ''),
      salary: item.salary ?? item.salaryEstimate ?? null,
      postedAt: parseDate(item.postedAt),
      description: item.description ?? item.jobDescription ?? null,
      applyUrl,
    })
  }
  return jobs
}
