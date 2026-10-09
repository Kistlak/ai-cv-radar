import { afterEach, describe, expect, it, vi } from 'vitest'
import { APIConnectionTimeoutError, APIUserAbortError } from '@anthropic-ai/sdk'

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}))

import {
  adzunaCountry,
  currencySymbol,
  guessCountry,
  matchCountry,
} from '@/lib/job-sources/country'
import { fetchAdzuna } from '@/lib/job-sources/adzuna'
import { fetchRemotive } from '@/lib/job-sources/remotive'
import { runActor } from '@/lib/job-sources/apify'
import { AI_TIMEOUT_MESSAGE, searchErrorMessage } from '@/lib/search-errors'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('guessCountry (Indeed)', () => {
  it('keeps the original mappings', () => {
    expect(guessCountry('London, UK')).toBe('gb')
    expect(guessCountry('Toronto')).toBe('ca')
    expect(guessCountry('Sydney')).toBe('au')
    expect(guessCountry('Bangalore, India')).toBe('in')
    expect(guessCountry('Berlin')).toBe('de')
    expect(guessCountry('Paris')).toBe('fr')
  })

  it("defaults to 'us' for empty, unknown and Indeed-unsupported places", () => {
    expect(guessCountry(undefined)).toBe('us')
    expect(guessCountry('')).toBe('us')
    expect(guessCountry('Kandy')).toBe('us')
    expect(guessCountry('Colombo')).toBe('us')
  })

  it('maps the newly added countries', () => {
    expect(guessCountry('Dubai')).toBe('ae')
    expect(guessCountry('Amsterdam')).toBe('nl')
    expect(guessCountry('Madrid, Spain')).toBe('es')
    expect(guessCountry('Singapore')).toBe('sg')
    expect(guessCountry('Zurich')).toBe('ch')
  })
})

describe('matchCountry', () => {
  it('recognises Adzuna-unsupported countries', () => {
    expect(matchCountry('Dubai, UAE')).toBe('ae')
    expect(matchCountry('Colombo, Sri Lanka')).toBe('lk')
  })

  it('returns null for unknown places', () => {
    expect(matchCountry('Kandy')).toBeNull()
    expect(matchCountry(null)).toBeNull()
  })
})

describe('adzunaCountry', () => {
  it("keeps 'gb' for no location or an unrecognised one", () => {
    expect(adzunaCountry(undefined)).toBe('gb')
    expect(adzunaCountry('Kandy')).toBe('gb')
  })

  it('uses the matched country when Adzuna covers it', () => {
    expect(adzunaCountry('Amsterdam')).toBe('nl')
    expect(adzunaCountry('New York')).toBe('us')
  })

  it('returns null for countries Adzuna does not cover', () => {
    expect(adzunaCountry('Dubai')).toBeNull()
    expect(adzunaCountry('Colombo')).toBeNull()
  })
})

describe('currencySymbol', () => {
  it('maps per country', () => {
    expect(currencySymbol('gb')).toBe('£')
    expect(currencySymbol('nl')).toBe('€')
    expect(currencySymbol('in')).toBe('₹')
    expect(currencySymbol('zz')).toBe('')
  })
})

function adzunaResponse(results: unknown[]) {
  return vi.fn<(url: string) => Promise<Response>>(async () => new Response(JSON.stringify({ results })))
}

const adzunaJob = {
  id: 'a1',
  title: 'Dev',
  company: { display_name: 'Acme' },
  location: { display_name: 'Amsterdam' },
  salary_min: 50000,
  salary_max: 70000,
  contract_time: 'contract',
  created: '2026-10-01T00:00:00Z',
  description: 'desc',
  redirect_url: 'https://adzuna.example/1',
}

describe('fetchAdzuna', () => {
  it('skips Adzuna for unsupported countries without calling the API', async () => {
    const fetchMock = adzunaResponse([])
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchAdzuna({ query: 'dev', location: 'Dubai' }, 'id', 'key')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("queries the matched country's index and uses its currency", async () => {
    const fetchMock = adzunaResponse([adzunaJob])
    vi.stubGlobal('fetch', fetchMock)
    const [job] = await fetchAdzuna({ query: 'dev', location: 'Amsterdam' }, 'id', 'key')
    expect(String(fetchMock.mock.calls[0][0])).toContain('/jobs/nl/search/1')
    expect(job.salary).toBe('€50k–€70k')
  })

  it('does not mark a contract job as remote', async () => {
    vi.stubGlobal('fetch', adzunaResponse([adzunaJob]))
    const [job] = await fetchAdzuna({ query: 'dev', location: 'Amsterdam' }, 'id', 'key')
    expect(job.remote).toBe(false)
  })

  it('marks remote from the location', async () => {
    vi.stubGlobal(
      'fetch',
      adzunaResponse([{ ...adzunaJob, location: { display_name: 'Remote, UK' } }])
    )
    const [job] = await fetchAdzuna({ query: 'dev' }, 'id', 'key')
    expect(job.remote).toBe(true)
  })

  it('falls back to the apply URL when the id is missing', async () => {
    vi.stubGlobal('fetch', adzunaResponse([{ ...adzunaJob, id: undefined }]))
    const [job] = await fetchAdzuna({ query: 'dev' }, 'id', 'key')
    expect(job.sourceJobId).toBe('https://adzuna.example/1')
  })
})

describe('fetchRemotive', () => {
  it('falls back to the URL when the id is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ jobs: [{ url: 'https://remotive.example/1', title: 't', company_name: 'c' }] })))
    )
    const [job] = await fetchRemotive({ query: 'dev' })
    expect(job.sourceJobId).toBe('https://remotive.example/1')
  })
})

describe('runActor', () => {
  it('does not start a run when the search is already cancelled', async () => {
    const start = vi.fn()
    const client = { actor: () => ({ start }), run: () => ({}) } as never
    const controller = new AbortController()
    controller.abort()
    await expect(runActor(client, 'actor', {}, controller.signal)).rejects.toBeDefined()
    expect(start).not.toHaveBeenCalled()
  })
})

describe('searchErrorMessage', () => {
  it('turns AI timeouts and aborts into one readable message', () => {
    expect(searchErrorMessage(new APIUserAbortError())).toBe(AI_TIMEOUT_MESSAGE)
    expect(searchErrorMessage(new APIConnectionTimeoutError())).toBe(AI_TIMEOUT_MESSAGE)
    expect(searchErrorMessage(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))).toBe(AI_TIMEOUT_MESSAGE)
    expect(searchErrorMessage(new DOMException('aborted', 'AbortError'))).toBe(AI_TIMEOUT_MESSAGE)
  })

  it('keeps other messages', () => {
    expect(searchErrorMessage(new Error('Add an Anthropic or Gemini API key in Settings'))).toBe(
      'Add an Anthropic or Gemini API key in Settings'
    )
    expect(searchErrorMessage('boom')).toBe('Unknown error')
  })
})
