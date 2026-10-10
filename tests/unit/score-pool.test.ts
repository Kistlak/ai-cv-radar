import { describe, expect, it } from 'vitest'
import type { RawJob } from '@/lib/job-sources/types'
import { preRankJobs, scoringPoolSize } from '@/lib/score-pool'

function job(id: string, title: string, description: string | null = null): RawJob {
  return {
    source: 'remotive',
    sourceJobId: id,
    title,
    company: `Company ${id}`,
    location: null,
    remote: true,
    salary: null,
    postedAt: null,
    description,
    applyUrl: `https://example.com/${id}`,
  }
}

const ids = (jobs: RawJob[]) => jobs.map((j) => j.sourceJobId)

describe('scoringPoolSize', () => {
  it('does not cap when the user wants all results', () => {
    expect(scoringPoolSize(null)).toBeNull()
  })

  it('keeps at least 30 jobs for small counts', () => {
    expect(scoringPoolSize(2)).toBe(30)
    expect(scoringPoolSize(5)).toBe(30)
  })

  it('scores four times the requested count', () => {
    expect(scoringPoolSize(10)).toBe(40)
    expect(scoringPoolSize(50)).toBe(200)
  })
})

describe('preRankJobs', () => {
  it('ranks title matches above description matches above no match', () => {
    const jobs = [
      job('none', 'Accountant', 'Spreadsheets'),
      job('desc', 'Backend Developer', 'We use Laravel daily'),
      job('title', 'Laravel Developer', null),
    ]
    expect(ids(preRankJobs(jobs, ['Laravel developer']))).toEqual(['title', 'desc', 'none'])
  })

  it('keeps the input order on ties', () => {
    const jobs = [job('a', 'PHP role'), job('b', 'Python role'), job('c', 'PHP job')]
    expect(ids(preRankJobs(jobs, ['php']))).toEqual(['a', 'c', 'b'])
  })

  it('returns the input order when every query word is a stop word', () => {
    const jobs = [job('a', 'Senior Developer'), job('b', 'Remote Engineer')]
    expect(ids(preRankJobs(jobs, ['Senior remote developer']))).toEqual(['a', 'b'])
  })

  it('ignores stop words when scoring', () => {
    const jobs = [job('a', 'Senior Remote Developer'), job('b', 'Vue Frontend')]
    expect(ids(preRankJobs(jobs, ['senior remote vue developer']))).toEqual(['b', 'a'])
  })

  it('matches whole words only', () => {
    const jobs = [job('good', 'Good communicator'), job('go', 'Go backend')]
    expect(ids(preRankJobs(jobs, ['go']))).toEqual(['go', 'good'])
  })

  it('matches terms with special characters', () => {
    const jobs = [
      job('plain', 'Java Developer'),
      job('csharp', 'C# Developer'),
      job('node', 'Node.js Engineer'),
    ]
    expect(ids(preRankJobs(jobs, ['C#'])).at(0)).toBe('csharp')
    expect(ids(preRankJobs(jobs, ['node.js'])).at(0)).toBe('node')
  })

  it('strips HTML from descriptions before matching', () => {
    const jobs = [
      job('attr', 'Role A', '<div class="react">Nothing here</div>'),
      job('text', 'Role B', '<p>Strong <b>React</b> skills</p>'),
    ]
    expect(ids(preRankJobs(jobs, ['react']))).toEqual(['text', 'attr'])
  })

  it('combines terms from every query', () => {
    const jobs = [job('a', 'Accountant'), job('b', 'Django Engineer'), job('c', 'Laravel Developer')]
    expect(ids(preRankJobs(jobs, ['laravel', 'django']))).toEqual(['b', 'c', 'a'])
  })

  it('does not mutate the input', () => {
    const jobs = [job('a', 'Accountant'), job('b', 'Laravel Developer')]
    preRankJobs(jobs, ['laravel'])
    expect(ids(jobs)).toEqual(['a', 'b'])
  })
})
