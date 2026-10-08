import { logger } from '@/lib/logger'
import { adzunaCountry, currencySymbol } from './country'
import { sourceSignal, type RawJob, type SearchParams } from './types'

interface AdzunaJob {
  id: string
  title: string
  company: { display_name: string }
  location: { display_name: string }
  salary_min?: number
  salary_max?: number
  contract_time?: string
  created: string
  description: string
  redirect_url: string
}

interface AdzunaResponse {
  results: AdzunaJob[]
}

export async function fetchAdzuna(
  params: SearchParams,
  appId: string,
  appKey: string
): Promise<RawJob[]> {
  // Query the index for the search's country; skip Adzuna for countries it
  // doesn't cover rather than returning another country's jobs.
  const country = adzunaCountry(params.location)
  if (!country) {
    logger.info({ event: 'job_source.adzuna_skipped', location: params.location ?? '' })
    return []
  }
  const symbol = currencySymbol(country)
  const url = new URL(`https://api.adzuna.com/v1/api/jobs/${country}/search/1`)
  url.searchParams.set('app_id', appId)
  url.searchParams.set('app_key', appKey)
  url.searchParams.set('what', params.query)
  url.searchParams.set('results_per_page', '20')
  if (params.location) url.searchParams.set('where', params.location)
  if (params.remoteOnly) url.searchParams.set('what_and', 'remote')

  const res = await fetch(url.toString(), { signal: sourceSignal(params) })
  if (!res.ok) throw new Error(`Adzuna error: ${res.status}`)
  const data: AdzunaResponse = await res.json()

  return (data.results ?? []).map((job) => {
    let salary: string | null = null
    if (job.salary_min && job.salary_max) {
      salary = `${symbol}${Math.round(job.salary_min / 1000)}k–${symbol}${Math.round(job.salary_max / 1000)}k`
    } else if (job.salary_min) {
      salary = `from ${symbol}${Math.round(job.salary_min / 1000)}k`
    }

    return {
      source: 'adzuna',
      sourceJobId: job.id || job.redirect_url,
      title: job.title,
      company: job.company.display_name,
      location: job.location.display_name ?? null,
      // A contract role isn't a remote one; only the location says remote.
      remote: /remote/i.test(job.location.display_name ?? ''),
      salary,
      postedAt: job.created ? new Date(job.created) : null,
      description: job.description ?? null,
      applyUrl: job.redirect_url,
    }
  })
}
