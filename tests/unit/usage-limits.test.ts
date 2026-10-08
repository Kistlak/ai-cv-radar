import { describe, expect, it, vi } from 'vitest'

// usage-limits imports the DB client; the pure helpers under test never touch it.
vi.mock('@/db', () => ({ db: {} }))

import {
  getQuotaConfig,
  isAiFallback,
  searchUsesFallback,
  secondsUntilUtcMidnight,
  utcDay,
} from '@/lib/usage-limits'

const noFallback = {
  anthropicKey: false,
  geminiKey: false,
  apifyToken: false,
  adzunaAppId: false,
  adzunaAppKey: false,
  rapidapiKey: false,
}

describe('getQuotaConfig', () => {
  it('uses defaults when env is empty', () => {
    expect(getQuotaConfig({})).toEqual({
      searchesPerDay: 5,
      aiGenerationsPerDay: 30,
      cvUploadsPerDay: 5,
      maxConcurrentSearches: 1,
    })
  })

  it('reads overrides, including 0 to disable', () => {
    expect(
      getQuotaConfig({
        QUOTA_SEARCHES_PER_DAY: '10',
        QUOTA_AI_GENERATIONS_PER_DAY: '0',
        QUOTA_CV_UPLOADS_PER_DAY: ' 2 ',
        MAX_CONCURRENT_SEARCHES: '3',
      })
    ).toEqual({ searchesPerDay: 10, aiGenerationsPerDay: 0, cvUploadsPerDay: 2, maxConcurrentSearches: 3 })
  })

  it('falls back to defaults on invalid values', () => {
    const config = getQuotaConfig({
      QUOTA_SEARCHES_PER_DAY: 'abc',
      QUOTA_AI_GENERATIONS_PER_DAY: '-1',
      QUOTA_CV_UPLOADS_PER_DAY: '2.5',
      MAX_CONCURRENT_SEARCHES: '',
    })
    expect(config).toEqual({
      searchesPerDay: 5,
      aiGenerationsPerDay: 30,
      cvUploadsPerDay: 5,
      maxConcurrentSearches: 1,
    })
  })
})

describe('isAiFallback', () => {
  it('checks the flag of the resolved provider only', () => {
    const anthropicFallback = { ...noFallback, anthropicKey: true }
    expect(isAiFallback(anthropicFallback, 'anthropic')).toBe(true)
    expect(isAiFallback(anthropicFallback, 'gemini')).toBe(false)

    const geminiFallback = { ...noFallback, geminiKey: true }
    expect(isAiFallback(geminiFallback, 'gemini')).toBe(true)
    expect(isAiFallback(geminiFallback, 'anthropic')).toBe(false)
  })

  it('is false when the user has their own keys', () => {
    expect(isAiFallback(noFallback, 'anthropic')).toBe(false)
    expect(isAiFallback(noFallback, 'gemini')).toBe(false)
  })
})

describe('searchUsesFallback', () => {
  it('counts when the AI key is a fallback', () => {
    expect(searchUsesFallback({ ...noFallback, anthropicKey: true }, 'anthropic', ['remotive'])).toBe(true)
  })

  it('counts when an Apify source runs on the fallback token', () => {
    const flags = { ...noFallback, apifyToken: true }
    expect(searchUsesFallback(flags, 'anthropic', ['remotive', 'linkedin'])).toBe(true)
    expect(searchUsesFallback(flags, 'anthropic', ['indeed'])).toBe(true)
    expect(searchUsesFallback(flags, 'anthropic', ['glassdoor'])).toBe(true)
  })

  it('does not count a fallback Apify token when no Apify source is selected', () => {
    expect(
      searchUsesFallback({ ...noFallback, apifyToken: true }, 'anthropic', ['remotive', 'adzuna', 'jsearch'])
    ).toBe(false)
  })

  it('does not count when everything is the user’s own', () => {
    expect(searchUsesFallback(noFallback, 'gemini', ['linkedin', 'remotive'])).toBe(false)
  })
})

describe('UTC day helpers', () => {
  it('utcDay returns the UTC date, not local', () => {
    expect(utcDay(new Date('2026-10-08T23:30:00Z'))).toBe('2026-10-08')
    expect(utcDay(new Date('2026-10-09T00:00:00Z'))).toBe('2026-10-09')
  })

  it('secondsUntilUtcMidnight counts to the next UTC midnight', () => {
    expect(secondsUntilUtcMidnight(new Date('2026-10-08T23:59:00Z'))).toBe(60)
    expect(secondsUntilUtcMidnight(new Date('2026-10-08T00:00:00Z'))).toBe(86_400)
    expect(secondsUntilUtcMidnight(new Date('2026-10-08T23:59:59.500Z'))).toBe(1)
  })

  it('handles month and year rollover', () => {
    expect(secondsUntilUtcMidnight(new Date('2026-12-31T23:00:00Z'))).toBe(3600)
  })
})
