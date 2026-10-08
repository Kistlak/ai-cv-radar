// Job apply URLs come from scrapers and the AI agent, so they are untrusted.
// Only http(s) links are allowed: a javascript: or data: URL rendered in an
// <a href> would run in the app's origin when clicked.
export function toHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}
