import type { RawJob, SearchParams } from './types'

interface RemotiveJob {
  id: number
  url: string
  title: string
  company_name: string
  company_logo?: string
  category: string
  tags: string[]
  job_type: string
  publication_date: string
  candidate_required_location: string
  salary: string
  description: string
}

interface RemotiveResponse {
  jobs: RemotiveJob[]
}

export async function fetchRemotive(params: SearchParams): Promise<RawJob[]> {
  const url = new URL('https://remotive.com/api/remote-jobs')
  url.searchParams.set('search', params.query)
  url.searchParams.set('limit', '20')

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`Remotive error: ${res.status}`)
  const data: RemotiveResponse = await res.json()

  return (data.jobs ?? []).map((job) => ({
    source: 'remotive',
    sourceJobId: String(job.id),
    title: job.title,
    company: job.company_name,
    location: job.candidate_required_location || 'Remote',
    remote: true,
    salary: job.salary || null,
    postedAt: job.publication_date ? new Date(job.publication_date) : null,
    description: job.description ?? null,
    applyUrl: job.url,
  }))
}
