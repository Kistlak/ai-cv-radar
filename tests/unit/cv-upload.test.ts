import { describe, expect, it } from 'vitest'
import {
  CV_TOO_LARGE_MESSAGE,
  MAX_CV_BYTES,
  MAX_PARSE_CHARS,
  MULTIPART_OVERHEAD_BYTES,
  isPdfBytes,
  textForParsing,
} from '@/lib/cv-upload'

const bytes = (s: string) => new TextEncoder().encode(s)

describe('isPdfBytes', () => {
  it('accepts a PDF header', () => {
    expect(isPdfBytes(bytes('%PDF-1.7\n...'))).toBe(true)
  })

  it('rejects other files', () => {
    expect(isPdfBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe(false) // PNG
    expect(isPdfBytes(bytes('<html>'))).toBe(false)
  })

  it('rejects empty or too-short input', () => {
    expect(isPdfBytes(new Uint8Array())).toBe(false)
    expect(isPdfBytes(bytes('%PD'))).toBe(false)
  })
})

describe('textForParsing', () => {
  it('leaves text under the cap unchanged', () => {
    expect(textForParsing('short cv')).toEqual({ text: 'short cv', truncated: false })
    const exact = 'x'.repeat(MAX_PARSE_CHARS)
    expect(textForParsing(exact)).toEqual({ text: exact, truncated: false })
  })

  it('cuts text over the cap and flags it', () => {
    const out = textForParsing('x'.repeat(MAX_PARSE_CHARS + 500))
    expect(out.text).toHaveLength(MAX_PARSE_CHARS)
    expect(out.truncated).toBe(true)
  })
})

describe('limits', () => {
  it('match the approved values', () => {
    expect(MAX_CV_BYTES).toBe(4 * 1024 * 1024)
    expect(MAX_PARSE_CHARS).toBe(20_000)
    expect(CV_TOO_LARGE_MESSAGE).toBe('CV must be a PDF under 4 MB')
  })

  it("stay under Vercel's 4.5 MB request-body limit, including multipart slack", () => {
    expect(MAX_CV_BYTES + MULTIPART_OVERHEAD_BYTES).toBeLessThan(4.5 * 1024 * 1024)
  })
})
