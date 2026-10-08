// Limits for CV uploads, shared by the upload route and the upload form.

// Below Vercel's 4.5 MB request-body limit, so an oversized file always gets
// our message instead of the platform's plain-text 413.
export const MAX_CV_MB = 4
export const MAX_CV_BYTES = MAX_CV_MB * 1024 * 1024
export const CV_TOO_LARGE_MESSAGE = `CV must be a PDF under ${MAX_CV_MB} MB`
// Slack for multipart boundaries and headers when pre-checking Content-Length.
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024

// Caps the CV text sent to the AI for parsing (about 6–8 pages of CV text).
// The full text is still saved; this only bounds the cost of the parse call.
export const MAX_PARSE_CHARS = 20_000

// The browser-reported MIME type is just a claim; real PDFs start with "%PDF-".
export function isPdfBytes(bytes: Uint8Array): boolean {
  const header = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-
  return bytes.length >= header.length && header.every((b, i) => bytes[i] === b)
}

export function textForParsing(rawText: string): { text: string; truncated: boolean } {
  if (rawText.length <= MAX_PARSE_CHARS) return { text: rawText, truncated: false }
  return { text: rawText.slice(0, MAX_PARSE_CHARS), truncated: true }
}
