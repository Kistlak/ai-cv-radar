import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}))

// A fake Apify client: the actor run succeeds at once and its dataset holds
// whatever `datasetItems` is set to.
let datasetItems: unknown[] = []
vi.mock('apify-client', () => ({
  ApifyClient: class {
    actor() {
      return { start: async () => ({ id: 'run1', status: 'SUCCEEDED', defaultDatasetId: 'ds1' }) }
    }
    dataset() {
      return { listItems: async () => ({ items: datasetItems }) }
    }
  },
}))

import { fetchApifyIndeed } from '@/lib/job-sources/apify'

// misceres/indeed-scraper's output: `postedAt` is the age as Indeed displays it,
// `postingDateParsed` the ISO date (its dataset schema, build 0.0.117).
const indeedItem = {
  id: 'abc123',
  positionName: 'Staff Nurse',
  company: 'City Hospital',
  location: 'Lisbon',
  url: 'https://www.indeed.com/viewjob?jk=abc123',
  postedAt: '3 days ago',
  postingDateParsed: '2026-10-12T09:00:00.000Z',
}

afterEach(() => {
  datasetItems = []
})

describe('fetchApifyIndeed posting date', () => {
  it('uses the ISO postingDateParsed, not the displayed "3 days ago"', async () => {
    datasetItems = [indeedItem]
    const [job] = await fetchApifyIndeed({ query: 'nurse', location: 'Lisbon' }, 'token')
    expect(job.postedAt?.toISOString()).toBe('2026-10-12T09:00:00.000Z')
  })

  it('leaves the date empty when only the displayed age is there', async () => {
    datasetItems = [{ ...indeedItem, postingDateParsed: undefined, postedAt: 'Today' }]
    const [job] = await fetchApifyIndeed({ query: 'nurse', location: 'Lisbon' }, 'token')
    expect(job.postedAt).toBeNull()
  })

  it('ignores an unparseable postingDateParsed', async () => {
    datasetItems = [{ ...indeedItem, postingDateParsed: 'not a date' }]
    const [job] = await fetchApifyIndeed({ query: 'nurse', location: 'Lisbon' }, 'token')
    expect(job.postedAt).toBeNull()
  })
})
