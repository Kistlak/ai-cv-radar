import type { RawJob, SearchParams } from './types'

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
  const country = 'gb'
  const url = new URL(`https://api.adzuna.com/v1/api/jobs/${country}/search/1`)
  url.searchParams.set('app_id', appId)
  url.searchParams.set('app_key', appKey)
  url.searchParams.set('what', params.query)
  url.searchParams.set('results_per_page', '20')
  if (params.location) url.searchParams.set('where', params.location)
  if (params.remoteOnly) url.searchParams.set('what_and', 'remote')

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`Adzuna error: ${res.status}`)
  const data: AdzunaResponse = await res.json()

  return (data.results ?? []).map((job) => {
    let salary: string | null = null
    if (job.salary_min && job.salary_max) {
      salary = `£${Math.round(job.salary_min / 1000)}k–£${Math.round(job.salary_max / 1000)}k`
    } else if (job.salary_min) {
      salary = `from £${Math.round(job.salary_min / 1000)}k`
    }

    return {
      source: 'adzuna',
      sourceJobId: job.id,
      title: job.title,
      company: job.company.display_name,
      location: job.location.display_name ?? null,
      remote: job.contract_time === 'contract' || /remote/i.test(job.location.display_name ?? ''),
      salary,
      postedAt: job.created ? new Date(job.created) : null,
      description: job.description ?? null,
      applyUrl: job.redirect_url,
    }
  })
}
