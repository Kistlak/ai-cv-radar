export interface RawJob {
  source: string
  sourceJobId: string
  title: string
  company: string
  location: string | null
  remote: boolean
  salary: string | null
  postedAt: Date | null
  description: string | null
  applyUrl: string
}

export interface SearchParams {
  query: string
  location?: string
  remoteOnly?: boolean
}
