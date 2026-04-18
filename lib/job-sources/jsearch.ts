import type { RawJob, SearchParams } from './types'

interface JSearchJob {
  job_id: string
  job_title: string
  employer_name: string
  job_city?: string
  job_country?: string
  job_is_remote: boolean
  job_min_salary?: number
  job_max_salary?: number
  job_salary_currency?: string
  job_posted_at_datetime_utc?: string
  job_description?: string
  job_apply_link: string
}

interface JSearchResponse {
  data: JSearchJob[]
}

export async function fetchJSearch(
  params: SearchParams,
  rapidapiKey: string
): Promise<RawJob[]> {
  const query = params.remoteOnly
    ? `${params.query} remote`
    : params.location
    ? `${params.query} in ${params.location}`
    : params.query

  const url = new URL('https://jsearch.p.rapidapi.com/search')
  url.searchParams.set('query', query)
  url.searchParams.set('num_pages', '1')
  url.searchParams.set('page', '1')
  if (params.remoteOnly) url.searchParams.set('remote_jobs_only', 'true')

  const res = await fetch(url.toString(), {
    headers: {
      'X-RapidAPI-Key': rapidapiKey,
      'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
    },
  })
  if (!res.ok) throw new Error(`JSearch error: ${res.status}`)
  const data: JSearchResponse = await res.json()

  return (data.data ?? []).map((job) => {
    const currency = job.job_salary_currency ?? 'USD'
    let salary: string | null = null
    if (job.job_min_salary && job.job_max_salary) {
      salary = `${currency} ${Math.round(job.job_min_salary / 1000)}k–${Math.round(job.job_max_salary / 1000)}k`
    } else if (job.job_min_salary) {
      salary = `from ${currency} ${Math.round(job.job_min_salary / 1000)}k`
    }

    const location = [job.job_city, job.job_country].filter(Boolean).join(', ') || null

    return {
      source: 'jsearch',
      sourceJobId: job.job_id,
      title: job.job_title,
      company: job.employer_name,
      location,
      remote: job.job_is_remote,
      salary,
      postedAt: job.job_posted_at_datetime_utc ? new Date(job.job_posted_at_datetime_utc) : null,
      description: job.job_description ?? null,
      applyUrl: job.job_apply_link,
    }
  })
}
