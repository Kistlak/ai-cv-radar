import { createCipheriv, randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, warned: [] as unknown[] }))

vi.mock('@/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (state.row ? [state.row] : []) }) }) }),
  },
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: (f: unknown) => state.warned.push(f), error: () => {} },
}))

import { decrypt, encrypt } from '@/lib/crypto'
import { getDecryptedKeys, nextPreferredProvider } from '@/lib/keys'

const KEY = randomBytes(32).toString('base64')
const OLD_KEY = randomBytes(32).toString('base64')

// The pre-versioning format: iv:tag:data, encrypted with `key`.
function legacyEncrypt(plaintext: string, key: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv)
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${data.toString('hex')}`
}

beforeEach(() => {
  vi.stubEnv('APP_ENCRYPTION_KEY', KEY)
  vi.stubEnv('APP_ENCRYPTION_KEY_PREVIOUS', '')
  for (const k of ['ANTHROPIC_KEY', 'GEMINI_KEY', 'APIFY_TOKEN', 'ADZUNA_APP_ID', 'ADZUNA_APP_KEY', 'RAPIDAPI_KEY']) {
    vi.stubEnv(`FALLBACK_${k}`, '')
  }
  state.row = null
  state.warned = []
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('crypto', () => {
  it('writes the v1 format and round-trips', () => {
    const c = encrypt('sk-ant-secret')
    expect(c.startsWith('v1:')).toBe(true)
    expect(c.split(':')).toHaveLength(4)
    expect(decrypt(c)).toBe('sk-ant-secret')
  })

  it('still reads values saved before versioning', () => {
    expect(decrypt(legacyEncrypt('old-secret', KEY))).toBe('old-secret')
  })

  it('reads values from the previous key during a rotation', () => {
    const saved = legacyEncrypt('rotated', OLD_KEY)
    expect(() => decrypt(saved)).toThrow()
    vi.stubEnv('APP_ENCRYPTION_KEY_PREVIOUS', OLD_KEY)
    expect(decrypt(saved)).toBe('rotated')
  })

  it('rejects malformed values', () => {
    expect(() => decrypt('garbage')).toThrow('Invalid ciphertext format')
    expect(() => decrypt('v2:a:b:c')).toThrow()
  })
})

describe('getDecryptedKeys', () => {
  it("decrypts the user's keys", async () => {
    state.row = { anthropicKey: encrypt('ant'), geminiKey: null, preferredAiProvider: 'anthropic' }
    const keys = await getDecryptedKeys('u1')
    expect(keys.anthropicKey).toBe('ant')
    expect(keys.usingFallback.anthropicKey).toBe(false)
  })

  it('treats an unreadable key as missing and falls back, without failing', async () => {
    vi.stubEnv('FALLBACK_ANTHROPIC_KEY', 'shared-ant')
    state.row = { anthropicKey: 'corrupt:value:here', geminiKey: encrypt('gem'), preferredAiProvider: 'anthropic' }
    const keys = await getDecryptedKeys('u1')
    expect(keys.anthropicKey).toBe('shared-ant')
    expect(keys.usingFallback.anthropicKey).toBe(true)
    expect(keys.geminiKey).toBe('gem')
    expect(state.warned).toEqual([expect.objectContaining({ event: 'keys.decrypt_failed', userId: 'u1', field: 'anthropic_key' })])
    // The value is never logged.
    expect(JSON.stringify(state.warned)).not.toContain('corrupt:value:here')
  })
})

describe('nextPreferredProvider', () => {
  const row = { preferredAiProvider: 'anthropic', anthropicKey: 'x', geminiKey: 'y' }

  it('switches to the other provider when the preferred key is removed', () => {
    expect(nextPreferredProvider('anthropic_key', row)).toBe('gemini')
    expect(nextPreferredProvider('gemini_key', { ...row, preferredAiProvider: 'gemini' })).toBe('anthropic')
  })

  it('keeps the preference when the other provider has no key', () => {
    expect(nextPreferredProvider('anthropic_key', { ...row, geminiKey: null })).toBe('anthropic')
  })

  it('keeps the preference when a different key is removed', () => {
    expect(nextPreferredProvider('apify_token', row)).toBe('anthropic')
    expect(nextPreferredProvider('gemini_key', row)).toBe('anthropic')
  })
})
