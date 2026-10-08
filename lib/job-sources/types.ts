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

// Per-request timeout for the plain-HTTP sources. A hung request must not hold
// the search past the route's maxDuration.
export const SOURCE_TIMEOUT_MS = 20_000
