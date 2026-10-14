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
import { fetchJSearch } from '@/lib/job-sources/jsearch'
import { fetchRemotive } from '@/lib/job-sources/remotive'
import { runActor } from '@/lib/job-sources/apify'
import { AI_TIMEOUT_MESSAGE, searchErrorMessage } from '@/lib/search-errors'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
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

  it('skips newly recognised countries it does not cover instead of searching the UK', () => {
    expect(adzunaCountry('Nairobi')).toBeNull()
    expect(adzunaCountry('Lisbon')).toBeNull()
  })
})

describe('matchCountry (every country)', () => {
  it('recognises countries and cities beyond the original 21', () => {
    expect(matchCountry('Nairobi, Kenya')).toBe('ke')
    expect(matchCountry('Lagos')).toBe('ng')
    expect(matchCountry('Lisbon, Portugal')).toBe('pt')
    expect(matchCountry('Dublin')).toBe('ie')
    expect(matchCountry('Tokyo')).toBe('jp')
    expect(matchCountry('Karachi')).toBe('pk')
    expect(matchCountry('Buenos Aires')).toBe('ar')
    expect(matchCountry('Kenya')).toBe('ke')
    expect(matchCountry('Remote - Vietnam')).toBe('vn')
  })

  it('matches name variants, aliases and accents', () => {
    expect(matchCountry('Türkiye')).toBe('tr')
    expect(matchCountry('Turkey')).toBe('tr')
    expect(matchCountry('Czech Republic')).toBe('cz')
    expect(matchCountry('Czechia')).toBe('cz')
    expect(matchCountry("Côte d'Ivoire")).toBe('ci')
    expect(matchCountry('Côte d’Ivoire')).toBe('ci')
    expect(matchCountry('Ivory Coast')).toBe('ci')
    expect(matchCountry('Bosnia and Herzegovina')).toBe('ba')
    expect(matchCountry('Bosnia & Herzegovina')).toBe('ba')
    expect(matchCountry('Hong Kong')).toBe('hk')
    expect(matchCountry('Myanmar')).toBe('mm')
    expect(matchCountry('Burma')).toBe('mm')
    expect(matchCountry('Saint Lucia')).toBe('lc')
    expect(matchCountry('St. Lucia')).toBe('lc')
    expect(matchCountry('São Paulo')).toBe('br')
    expect(matchCountry('Sao Paulo')).toBe('br')
    expect(matchCountry('Zürich')).toBe('ch')
  })

  it('picks the right country when one name contains another', () => {
    expect(matchCountry('Papua New Guinea')).toBe('pg')
    expect(matchCountry('Guinea')).toBe('gn')
    expect(matchCountry('South Sudan')).toBe('ss')
    expect(matchCountry('Sudan')).toBe('sd')
    expect(matchCountry('Nigeria')).toBe('ng')
    expect(matchCountry('Niger')).toBe('ne')
    expect(matchCountry('Dominican Republic')).toBe('do')
    expect(matchCountry('South Korea')).toBe('kr')
    expect(matchCountry('Korea')).toBe('kr')
    expect(matchCountry('North Korea')).toBe('kp')
    expect(matchCountry('DR Congo')).toBe('cd')
    expect(matchCountry('Democratic Republic of the Congo')).toBe('cd')
    expect(matchCountry('Congo')).toBe('cg')
  })

  it('keeps US places that contain another country name in the US', () => {
    expect(matchCountry('New Jersey')).toBe('us')
    expect(matchCountry('Jersey City')).toBe('us')
    expect(matchCountry('Jersey')).toBe('je')
    expect(matchCountry('New Mexico')).toBe('us')
    expect(matchCountry('Mexico City')).toBe('mx')
    expect(matchCountry('Atlanta, Georgia')).toBe('us')
    expect(matchCountry('Georgia, USA')).toBe('us')
    expect(matchCountry('Tbilisi, Georgia')).toBe('ge')
    expect(matchCountry('Sydney, New South Wales')).toBe('au')
  })

  it('does not match a country inside another word or non-countries', () => {
    expect(matchCountry('Indiana')).toBeNull()
    expect(matchCountry('European Union')).toBeNull()
    expect(matchCountry('Unknown Region')).toBeNull()
  })
})

describe('guessCountry (every country)', () => {
  it("uses the country when Indeed's actor lists it, otherwise 'us'", () => {
    expect(guessCountry('Lisbon')).toBe('pt')
    expect(guessCountry('Tokyo, Japan')).toBe('jp')
    expect(guessCountry('Nairobi')).toBe('us')
    expect(guessCountry('Colombo')).toBe('us')
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

  it('asks for jobs within JOB_MAX_AGE_DAYS, and not when it is 0', async () => {
    const fetchMock = adzunaResponse([])
    vi.stubGlobal('fetch', fetchMock)
    await fetchAdzuna({ query: 'dev' }, 'id', 'key')
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('max_days_old')).toBe('30')

    vi.stubEnv('JOB_MAX_AGE_DAYS', '0')
    await fetchAdzuna({ query: 'dev' }, 'id', 'key')
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.has('max_days_old')).toBe(false)
  })
})

describe('fetchJSearch', () => {
  it('asks for the smallest date_posted bucket covering JOB_MAX_AGE_DAYS', async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(
      async () => new Response(JSON.stringify({ data: [] }))
    )
    vi.stubGlobal('fetch', fetchMock)
    const datePosted = (call: number) =>
      new URL(String(fetchMock.mock.calls[call][0])).searchParams.get('date_posted')

    await fetchJSearch({ query: 'dev' }, 'key')
    expect(datePosted(0)).toBe('month')

    vi.stubEnv('JOB_MAX_AGE_DAYS', '7')
    await fetchJSearch({ query: 'dev' }, 'key')
    expect(datePosted(1)).toBe('week')

    vi.stubEnv('JOB_MAX_AGE_DAYS', '0')
    await fetchJSearch({ query: 'dev' }, 'key')
    expect(datePosted(2)).toBeNull()
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
