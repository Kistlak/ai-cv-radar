import { describe, expect, it, vi } from 'vitest'

// key-status imports the DB client; the pure helpers under test never touch it.
vi.mock('@/db', () => ({ db: {} }))

import { canUseAi, resolveKeyStatus } from '@/lib/key-status'

const empty = {
  anthropicKey: null,
  geminiKey: null,
  apifyToken: null,
  adzunaAppId: null,
  adzunaAppKey: null,
  rapidapiKey: null,
}

describe('resolveKeyStatus', () => {
  it('is all null with no row and no fallbacks', () => {
    const s = resolveKeyStatus(undefined, {})
    expect(s).toEqual({ anthropic: null, gemini: null, apify: null, adzuna: null, jsearch: null })
    expect(canUseAi(s)).toBe(false)
  })

  it("marks the user's own keys as 'user'", () => {
    const s = resolveKeyStatus({ ...empty, anthropicKey: 'enc', apifyToken: 'enc', rapidapiKey: 'enc' }, {})
    expect(s).toMatchObject({ anthropic: 'user', apify: 'user', jsearch: 'user', gemini: null })
  })

  it("marks fallback-only keys as 'shared'", () => {
    const s = resolveKeyStatus(empty, { FALLBACK_GEMINI_KEY: 'g', FALLBACK_APIFY_TOKEN: 'a' })
    expect(s).toMatchObject({ gemini: 'shared', apify: 'shared', anthropic: null })
  })

  it("prefers the user's key over the fallback", () => {
    const s = resolveKeyStatus({ ...empty, anthropicKey: 'enc' }, { FALLBACK_ANTHROPIC_KEY: 'f' })
    expect(s.anthropic).toBe('user')
  })

  it('needs both Adzuna parts', () => {
    expect(resolveKeyStatus({ ...empty, adzunaAppId: 'id' }, {}).adzuna).toBeNull()
    expect(resolveKeyStatus({ ...empty, adzunaAppId: 'id', adzunaAppKey: 'enc' }, {}).adzuna).toBe('user')
    expect(
      resolveKeyStatus(empty, { FALLBACK_ADZUNA_APP_ID: 'id', FALLBACK_ADZUNA_APP_KEY: 'k' }).adzuna
    ).toBe('shared')
    expect(resolveKeyStatus(empty, { FALLBACK_ADZUNA_APP_ID: 'id' }).adzuna).toBeNull()
  })

  it("mixes Adzuna parts like getDecryptedKeys (user id + shared key = 'shared')", () => {
    expect(
      resolveKeyStatus({ ...empty, adzunaAppId: 'id' }, { FALLBACK_ADZUNA_APP_KEY: 'k' }).adzuna
    ).toBe('shared')
  })

  it('treats empty strings as missing', () => {
    expect(resolveKeyStatus({ ...empty, geminiKey: '' }, { FALLBACK_GEMINI_KEY: '' }).gemini).toBeNull()
  })
})

describe('canUseAi', () => {
  it('accepts a Gemini-only user', () => {
    expect(canUseAi(resolveKeyStatus({ ...empty, geminiKey: 'enc' }, {}))).toBe(true)
  })

  it('accepts a shared Anthropic key', () => {
    expect(canUseAi(resolveKeyStatus(empty, { FALLBACK_ANTHROPIC_KEY: 'f' }))).toBe(true)
  })
})
