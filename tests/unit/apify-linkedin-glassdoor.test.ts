import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}))

// A fake Apify client: the actor run succeeds at once and its dataset holds
// whatever `datasetItems` is set to. The input the actor was started with is
// kept in `startInput`.
let datasetItems: unknown[] = []
let startInput: unknown
vi.mock('apify-client', () => ({
  ApifyClient: class {
    actor() {
      return {
        start: async (input: unknown) => {
          startInput = input
          return { id: 'run1', status: 'SUCCEEDED', defaultDatasetId: 'ds1' }
        },
      }
    }
    dataset() {
      return { listItems: async () => ({ items: datasetItems }) }
    }
  },
}))

import { fetchApifyGlassdoor, fetchApifyLinkedIn } from '@/lib/job-sources/apify'

afterEach(() => {
  datasetItems = []
  startInput = undefined
})

// bebity/linkedin-jobs-scraper's output (README sample, build 0.0.226):
// `postedTime` is display text, `publishedAt` the date, `jobUrl` the LinkedIn link.
const linkedInItem = {
  id: '4459772101',
  title: 'Senior Software Engineer',
  companyName: 'Example GmbH',
  location: 'Berlin, Germany',
  workType: 'Remote',
  salary: '€70,000 - €90,000 per year',
  postedTime: '3 days ago',
  publishedAt: '2026-08-29',
  applyType: 'EXTERNAL',
  applyUrl: 'https://careers.example.com/apply/4459772101',
  jobUrl: 'https://www.linkedin.com/jobs/view/4459772101',
  description: 'We are looking for a Senior Software Engineer...',
}

describe('fetchApifyLinkedIn mapping', () => {
  it('starts the actor with the search URL and a 25-job cap', async () => {
    await fetchApifyLinkedIn({ query: 'engineer', location: 'Berlin' }, 'token')
    expect(startInput).toMatchObject({ maxRowsPerUrl: 25, companyProfile: false })
    const [start] = (startInput as { startUrls: { url: string }[] }).startUrls
    expect(start.url).toContain('linkedin.com/jobs/search/')
    expect(start.url).toContain('keywords=engineer')
  })

  it('reads the publishedAt date and the salary text', async () => {
    datasetItems = [linkedInItem]
    const [job] = await fetchApifyLinkedIn({ query: 'engineer', location: 'Berlin' }, 'token')
    expect(job.postedAt?.toISOString()).toBe('2026-08-29T00:00:00.000Z')
    expect(job.salary).toBe('€70,000 - €90,000 per year')
    expect(job.applyUrl).toBe('https://careers.example.com/apply/4459772101')
    expect(job.remote).toBe(true)
  })

  it('falls back to jobUrl for an Easy Apply job with no applyUrl', async () => {
    datasetItems = [{ ...linkedInItem, applyType: 'EASY_APPLY', applyUrl: undefined }]
    const jobs = await fetchApifyLinkedIn({ query: 'engineer', location: 'Berlin' }, 'token')
    expect(jobs).toHaveLength(1)
    expect(jobs[0].applyUrl).toBe('https://www.linkedin.com/jobs/view/4459772101')
  })

  it('leaves the date empty when only the displayed age is there', async () => {
    datasetItems = [{ ...linkedInItem, publishedAt: undefined }]
    const [job] = await fetchApifyLinkedIn({ query: 'engineer', location: 'Berlin' }, 'token')
    expect(job.postedAt).toBeNull()
  })

  it('still maps the old field names', async () => {
    datasetItems = [{
      id: 7, title: 'Engineer', companyName: 'Acme', link: 'https://www.linkedin.com/jobs/view/7',
      salaryInfo: ['$100k', '$120k'], postedAt: '2026-10-01T00:00:00.000Z',
    }]
    const [job] = await fetchApifyLinkedIn({ query: 'engineer' }, 'token')
    expect(job.applyUrl).toBe('https://www.linkedin.com/jobs/view/7')
    expect(job.salary).toBe('$100k · $120k')
    expect(job.postedAt?.toISOString()).toBe('2026-10-01T00:00:00.000Z')
  })
})

// bebity/glassdoor-jobs-scraper's output (README sample, build 0.1.66): flat
// snake_case rows, `job_location` and `job_salary` are objects.
const glassdoorItem = {
  job_id: '1010174027691',
  job_title: 'Lead Blockchain Protocol Engineer',
  company_name: 'Experis',
  job_url: 'https://www.glassdoor.com/partner/jobListing.htm?pos=101',
  job_apply_url: 'https://www.glassdoor.com/partner/jobListing.htm?tgt=APPLY_START',
  job_posted_date: '2026-08-19T00:00:00',
  job_publication_age: '80 days ago',
  job_age_in_days: 80,
  job_expired: false,
  job_remote: false,
  job_description: 'Our client, a leading organization...',
  job_location: { unknown: 'Woodbridge, NJ', country: 'United States' },
  job_salary: {
    min: 70000, median: 80000, max: 90000, currency: 'USD', currency_symbol: '$',
    pay_period: 'annual', estimated: false, source: 'EMPLOYER_PROVIDED',
  },
}

describe('fetchApifyGlassdoor mapping', () => {
  it('starts the actor with the search URL and a 25-job cap', async () => {
    await fetchApifyGlassdoor({ query: 'engineer' }, 'token')
    expect(startInput).toMatchObject({ maxItems: 25 })
    expect((startInput as { searchUrls: string[] }).searchUrls[0]).toContain('glassdoor.com/Job/jobs.htm')
  })

  it('maps a snake_case row', async () => {
    datasetItems = [glassdoorItem]
    const jobs = await fetchApifyGlassdoor({ query: 'engineer', location: 'New Jersey' }, 'token')
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      source: 'glassdoor',
      sourceJobId: '1010174027691',
      title: 'Lead Blockchain Protocol Engineer',
      company: 'Experis',
      location: 'Woodbridge, NJ',
      remote: false,
      salary: '$70k–$90k per year',
      description: 'Our client, a leading organization...',
      applyUrl: 'https://www.glassdoor.com/partner/jobListing.htm?tgt=APPLY_START',
    })
    // No timezone in the actor's value, so it's read as server-local time.
    expect(jobs[0].postedAt?.getTime()).toBe(new Date('2026-08-19T00:00:00').getTime())
  })

  it('formats an hourly salary and a remote flag', async () => {
    datasetItems = [{
      ...glassdoorItem,
      job_remote: true,
      job_salary: { min: 73, max: 73, currency: 'USD', currency_symbol: '$', pay_period: 'hourly', estimated: true },
    }]
    const [job] = await fetchApifyGlassdoor({ query: 'engineer' }, 'token')
    expect(job.salary).toBe('$73 per hour (estimate)')
    expect(job.remote).toBe(true)
  })

  it('skips expired jobs', async () => {
    datasetItems = [{ ...glassdoorItem, job_expired: true }]
    expect(await fetchApifyGlassdoor({ query: 'engineer' }, 'token')).toEqual([])
  })

  it('still maps the old field names', async () => {
    datasetItems = [{
      id: 9, jobTitle: 'Engineer', employer: 'Acme', jobLink: 'https://www.glassdoor.com/job/9',
      location: 'Remote', salaryEstimate: '$100k', postedAt: '2026-10-01T00:00:00.000Z',
    }]
    const [job] = await fetchApifyGlassdoor({ query: 'engineer' }, 'token')
    expect(job).toMatchObject({ title: 'Engineer', company: 'Acme', remote: true, salary: '$100k' })
    expect(job.postedAt?.toISOString()).toBe('2026-10-01T00:00:00.000Z')
  })
})
