import { describe, expect, it } from 'vitest'
import {
  countLabels,
  isUnscored,
  meanScoreByLabel,
  ndcgAt,
  type Label,
} from '../eval/metrics'

describe('countLabels', () => {
  it('counts every label, including the absent ones', () => {
    expect(countLabels(['good', 'bad', 'good', 'stale'])).toEqual({
      good: 2,
      ok: 0,
      bad: 1,
      ineligible: 0,
      stale: 1,
    })
  })

  it('handles an empty top 10', () => {
    expect(countLabels([])).toEqual({ good: 0, ok: 0, bad: 0, ineligible: 0, stale: 0 })
  })
})

describe('ndcgAt', () => {
  const all: Label[] = ['good', 'good', 'ok', 'bad', 'ineligible']

  it('is 1 for the ideal order', () => {
    expect(ndcgAt(3, ['good', 'good', 'ok'], all)).toBeCloseTo(1)
  })

  it('is 0 when nothing worth showing is ranked', () => {
    expect(ndcgAt(3, ['bad', 'ineligible', 'stale'], all)).toBe(0)
  })

  it('matches a hand-computed value', () => {
    // DCG of [ok, good, bad] = 1/log2(2) + 3/log2(3) + 0 = 1 + 1.8928 = 2.8928
    // ideal [good, good, ok] = 3 + 3/log2(3) + 1/log2(4) = 3 + 1.8928 + 0.5 = 5.3928
    expect(ndcgAt(3, ['ok', 'good', 'bad'], all)).toBeCloseTo(2.8928 / 5.3928, 3)
  })

  it('is 0 when no job is worth showing at all', () => {
    expect(ndcgAt(10, ['bad'], ['bad', 'stale'])).toBe(0)
  })
})

describe('isUnscored', () => {
  it('flags the fallback reasons only', () => {
    expect(isUnscored({ matchReason: 'Score unavailable' })).toBe(true)
    expect(isUnscored({ matchReason: '' })).toBe(true)
    expect(isUnscored({ matchReason: 'Strong ICU experience' })).toBe(false)
  })
})

describe('meanScoreByLabel', () => {
  it('averages per label and skips absent labels', () => {
    expect(
      meanScoreByLabel([
        { label: 'good', matchScore: 90 },
        { label: 'good', matchScore: 81 },
        { label: 'bad', matchScore: 10 },
      ])
    ).toEqual({ good: 86, bad: 10 })
  })
})
