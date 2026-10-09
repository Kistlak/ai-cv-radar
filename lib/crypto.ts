import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
// Ciphertext format: `v1:iv:authTag:data` (hex). Values saved before the
// version prefix existed are `iv:authTag:data` and still decrypt.
const VERSION = 'v1'

function getKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY
  if (!raw) throw new Error('APP_ENCRYPTION_KEY is not set')
  return Buffer.from(raw, 'base64')
}

// Keys tried on decrypt: the current one, then APP_ENCRYPTION_KEY_PREVIOUS
// (set it while rotating, so values saved with the old key still read; each
// is re-encrypted with the current key the next time the user saves it).
function decryptionKeys(): Buffer[] {
  const keys = [getKey()]
  const previous = process.env.APP_ENCRYPTION_KEY_PREVIOUS
  if (previous) keys.push(Buffer.from(previous, 'base64'))
  return keys
}

export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${VERSION}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(':')
  const fields = parts.length === 4 && parts[0] === VERSION ? parts.slice(1) : parts
  const [ivHex, authTagHex, encryptedHex] = fields
  if (fields.length !== 3 || !ivHex || !authTagHex || !encryptedHex) {
    throw new Error('Invalid ciphertext format')
  }
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const encrypted = Buffer.from(encryptedHex, 'hex')

  let lastError: unknown
  for (const key of decryptionKeys()) {
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv)
      decipher.setAuthTag(authTag)
      return decipher.update(encrypted) + decipher.final('utf8')
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}
