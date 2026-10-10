import { describe, expect, it } from 'vitest'
import { CvStructuredSchema } from '@/lib/ai/schemas'
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

  it('matches terms that start with punctuation inside words (.net in ASP.NET)', () => {
    const jobs = [
      job('java', 'Java Developer'),
      job('asp', 'ASP.NET Core Developer'),
      job('dotnet', '.NET Developer'),
    ]
    expect(ids(preRankJobs(jobs, ['.net']))).toEqual(['asp', 'dotnet', 'java'])
  })

  it('counts description text up to 3,000 characters', () => {
    const filler = 'x '.repeat(600)
    const jobs = [
      job('none', 'Role A', 'nothing relevant'),
      job('late', 'Role B', `${filler}Requires Laravel experience.`),
      job('tooLate', 'Role C', `${'x '.repeat(1600)}Requires Laravel experience.`),
    ]
    expect(ids(preRankJobs(jobs, ['laravel']))).toEqual(['late', 'none', 'tooLate'])
  })
})

describe('preRankJobs with a CV profile', () => {
  const cv = (skills: string[], roles: string[] = []) =>
    CvStructuredSchema.parse({
      skills,
      experience: roles.map((role) => ({ role, company: 'Company' })),
    })

  it('uses CV role titles to keep synonym-title jobs', () => {
    const jobs = [job('a', 'Office Manager'), job('b', 'Product Designer')]
    expect(ids(preRankJobs(jobs, ['ux']))).toEqual(['a', 'b'])
    expect(ids(preRankJobs(jobs, ['ux'], cv([], ['Product Designer'])))).toEqual(['b', 'a'])
  })

  it('ranks a CV skill in the title above one only in the description', () => {
    const jobs = [job('desc', 'Designer', 'Uses Figma daily'), job('title', 'Figma Specialist')]
    expect(ids(preRankJobs(jobs, ['ux'], cv(['Figma'])))).toEqual(['title', 'desc'])
  })

  it('weighs a query term in the title above a CV term in the title', () => {
    const jobs = [job('cv', 'Figma Specialist'), job('query', 'UX Specialist')]
    expect(ids(preRankJobs(jobs, ['ux'], cv(['Figma'])))).toEqual(['query', 'cv'])
  })

  it('does not count a term twice when it is in both the query and the CV', () => {
    // Counted twice, "Figma" (3 + 2) would beat "Sketch" + description (3 + 1).
    const jobs = [job('p', 'Figma'), job('q', 'Sketch', 'figma')]
    expect(ids(preRankJobs(jobs, ['figma sketch'], cv(['Figma'])))).toEqual(['q', 'p'])
  })

  it('behaves as before without a usable CV', () => {
    const jobs = [job('a', 'Accountant'), job('b', 'Laravel Developer', 'php'), job('c', 'PHP')]
    const before = ids(preRankJobs(jobs, ['laravel php']))
    expect(ids(preRankJobs(jobs, ['laravel php'], null))).toEqual(before)
    expect(ids(preRankJobs(jobs, ['laravel php'], cv([])))).toEqual(before)
  })

  it('caps the number of CV terms', () => {
    const skills = Array.from({ length: 100 }, (_, i) => `skill${i + 1}`)
    // skill95 is past the cap of 80, so only skill5 counts.
    const jobs = [job('a', 'skill95'), job('b', 'skill5')]
    expect(ids(preRankJobs(jobs, ['ux'], cv(skills)))).toEqual(['b', 'a'])
  })
})
