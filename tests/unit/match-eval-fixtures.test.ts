import { describe, expect, it } from 'vitest'
import { listCaseNames, loadCase } from '../eval/load-cases'
import { countLabels } from '../eval/metrics'

// Integrity of the synthetic match-eval cases (format and required mix in
// tests/fixtures/match-eval/README.md). No AI calls; runs in `npm test`.

const EXPECTED_CASES = [
  'accountant-ae',
  'designer-pt',
  'hospitality-sg',
  'logistics-ca',
  'nurse-gb',
  'sales-us',
  'software-lk',
  'teacher-au',
]

const REQUIRED_MIX = { good: 10, ok: 8, bad: 18, ineligible: 8, stale: 4 }

// Labels the owner changed after review; the README mix applies otherwise.
const MIX_OVERRIDES: Record<string, Partial<typeof REQUIRED_MIX>> = {
  // nurse-gb-11 (Dublin ICU): ineligible → ok, since UK citizens can work in Ireland.
  'nurse-gb': { ok: 9, ineligible: 7 },
}

const trapCount =(labels: Record<string, { trap?: string }>, trap: string) =>
  Object.values(labels).filter((l) => l.trap === trap).length

describe('match-eval fixtures', () => {
  it('has the 8 planned cases', () => {
    expect(listCaseNames()).toEqual(EXPECTED_CASES)
  })

  describe.each(EXPECTED_CASES)('%s', (name) => {
    const c = loadCase(name)
    const ids = c.jobs.map((j) => j.sourceJobId)

    it('has 48 jobs with unique, sequential ids', () => {
      expect(ids).toEqual(
        Array.from({ length: 48 }, (_, i) => `${name}-${String(i + 1).padStart(2, '0')}`)
      )
    })

    it('labels every job and nothing else', () => {
      expect(Object.keys(c.labels).sort()).toEqual([...ids].sort())
    })

    it('has the required label mix', () => {
      expect(countLabels(Object.values(c.labels).map((l) => l.label))).toEqual({
        ...REQUIRED_MIX,
        ...MIX_OVERRIDES[name],
      })
    })

    it('has the required traps', () => {
      expect(trapCount(c.labels, 'late-requirements')).toBeGreaterThanOrEqual(3)
      expect(trapCount(c.labels, 'synonym-title')).toBeGreaterThanOrEqual(2)
      expect(trapCount(c.labels, 'keyword-stuffed')).toBe(4)
      expect(trapCount(c.labels, 'different-field')).toBeGreaterThanOrEqual(4)
      expect(trapCount(c.labels, 'seniority')).toBeGreaterThanOrEqual(4)
      expect(trapCount(c.labels, 'missing-hard-requirement')).toBeGreaterThanOrEqual(4)
    })

    it('dates stale jobs 45-90 days back and fresh ones within 20', () => {
      const now = Date.now()
      for (const job of c.jobs) {
        const days = job.postedAt ? Math.round((now - job.postedAt.getTime()) / 86_400_000) : null
        if (c.labels[job.sourceJobId].label === 'stale') {
          expect(days).not.toBeNull()
          expect(days!).toBeGreaterThanOrEqual(45)
          expect(days!).toBeLessThanOrEqual(90)
        } else if (days !== null) {
          expect(days).toBeLessThanOrEqual(20)
        }
      }
    })

    it('searches with 3 queries and 10 results', () => {
      expect(c.search.queries).toHaveLength(3)
      expect(c.search.maxResults).toBe(10)
    })
  })
})
