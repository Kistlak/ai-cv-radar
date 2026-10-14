import { describe, expect, it } from 'vitest'
import {
  glassdoorFromAge,
  isFresh,
  jobMaxAgeDays,
  jsearchDatePosted,
  postedAgoLabel,
} from '@/lib/freshness'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 14, 12)
const ago = (ms: number) => ({ postedAt: new Date(NOW - ms) })

describe('jobMaxAgeDays', () => {
  it('defaults to 30 when unset or blank', () => {
    expect(jobMaxAgeDays({})).toBe(30)
    expect(jobMaxAgeDays({ JOB_MAX_AGE_DAYS: ' ' })).toBe(30)
  })

  it('reads a whole number of days, including 0', () => {
    expect(jobMaxAgeDays({ JOB_MAX_AGE_DAYS: '14' })).toBe(14)
    expect(jobMaxAgeDays({ JOB_MAX_AGE_DAYS: '0' })).toBe(0)
  })

  it('falls back to 30 for invalid values', () => {
    for (const raw of ['-1', '2.5', 'x']) {
      expect(jobMaxAgeDays({ JOB_MAX_AGE_DAYS: raw })).toBe(30)
    }
  })
})

describe('isFresh', () => {
  it('keeps jobs with no date or an unparseable one', () => {
    expect(isFresh({ postedAt: null }, NOW, 30)).toBe(true)
    expect(isFresh({ postedAt: new Date('not a date') }, NOW, 30)).toBe(true)
  })

  it('keeps a job exactly maxDays old and drops one just older', () => {
    expect(isFresh(ago(30 * DAY), NOW, 30)).toBe(true)
    expect(isFresh(ago(30 * DAY + 1), NOW, 30)).toBe(false)
  })

  it('keeps future dates', () => {
    expect(isFresh(ago(-DAY), NOW, 30)).toBe(true)
  })

  it('keeps everything when the window is 0', () => {
    expect(isFresh(ago(400 * DAY), NOW, 0)).toBe(true)
  })
})

describe('postedAgoLabel', () => {
  it('says today for under a day and for future dates', () => {
    expect(postedAgoLabel(new Date(NOW), NOW)).toBe('Posted today')
    expect(postedAgoLabel(new Date(NOW - 23 * 3_600_000), NOW)).toBe('Posted today')
    expect(postedAgoLabel(new Date(NOW + DAY), NOW)).toBe('Posted today')
  })

  it('counts whole days', () => {
    expect(postedAgoLabel(new Date(NOW - DAY), NOW)).toBe('Posted 1 day ago')
    expect(postedAgoLabel(new Date(NOW - 5.5 * DAY), NOW)).toBe('Posted 5 days ago')
  })
})

describe('jsearchDatePosted', () => {
  it('picks the smallest bucket that covers the window', () => {
    expect(jsearchDatePosted(1)).toBe('today')
    expect(jsearchDatePosted(2)).toBe('3days')
    expect(jsearchDatePosted(3)).toBe('3days')
    expect(jsearchDatePosted(7)).toBe('week')
    expect(jsearchDatePosted(8)).toBe('month')
    expect(jsearchDatePosted(30)).toBe('month')
  })

  it('sends nothing past 30 days or when off', () => {
    expect(jsearchDatePosted(31)).toBeNull()
    expect(jsearchDatePosted(0)).toBeNull()
  })
})

describe('glassdoorFromAge', () => {
  it('picks the smallest bucket that covers the window', () => {
    expect(glassdoorFromAge(1)).toBe(1)
    expect(glassdoorFromAge(2)).toBe(3)
    expect(glassdoorFromAge(8)).toBe(14)
    expect(glassdoorFromAge(14)).toBe(14)
    expect(glassdoorFromAge(30)).toBe(30)
  })

  it('sends nothing past 30 days or when off', () => {
    expect(glassdoorFromAge(31)).toBeNull()
    expect(glassdoorFromAge(0)).toBeNull()
  })
})
