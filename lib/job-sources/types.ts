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
  // Aborted when the user cancels the search.
  signal?: AbortSignal
}

// Per-request timeout for the plain-HTTP sources. A hung request must not hold
// the search past the route's maxDuration.
export const SOURCE_TIMEOUT_MS = 20_000

// The source timeout, combined with the search's cancel signal when there is one.
export function sourceSignal(params: SearchParams): AbortSignal {
  const timeout = AbortSignal.timeout(SOURCE_TIMEOUT_MS)
  return params.signal ? AbortSignal.any([params.signal, timeout]) : timeout
}
