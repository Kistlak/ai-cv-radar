// Maps a free-text search location to a 2-letter country code, shared by the
// sources that query a per-country index (Indeed via Apify, Adzuna).

const COUNTRY_PATTERNS: Array<[code: string, pattern: RegExp]> = [
  ['gb', /\b(uk|united kingdom|england|london|manchester|scotland|wales)\b/],
  ['ca', /\b(canada|toronto|vancouver|montreal)\b/],
  ['au', /\b(australia|sydney|melbourne)\b/],
  ['in', /\b(india|bangalore|mumbai|delhi|hyderabad)\b/],
  ['de', /\b(germany|berlin|munich)\b/],
  ['fr', /\b(france|paris)\b/],
  ['us', /\b(usa|united states|new york|san francisco|seattle|austin|boston|chicago|los angeles)\b/],
  ['nl', /\b(netherlands|amsterdam|rotterdam)\b/],
  ['es', /\b(spain|madrid|barcelona)\b/],
  ['it', /\b(italy|milan|rome)\b/],
  ['sg', /\b(singapore)\b/],
  ['nz', /\b(new zealand|auckland|wellington)\b/],
  ['za', /\b(south africa|johannesburg|cape town)\b/],
  ['br', /\b(brazil|são paulo|sao paulo)\b/],
  ['mx', /\b(mexico)\b/],
  ['pl', /\b(poland|warsaw|krakow)\b/],
  ['at', /\b(austria|vienna)\b/],
  ['be', /\b(belgium|brussels)\b/],
  ['ch', /\b(switzerland|zurich|geneva)\b/],
  ['ae', /\b(uae|united arab emirates|dubai|abu dhabi)\b/],
  ['lk', /\b(sri lanka|colombo)\b/],
]

// The country a location names, or null when it isn't recognised.
export function matchCountry(location?: string | null): string | null {
  if (!location) return null
  const loc = location.toLowerCase()
  for (const [code, pattern] of COUNTRY_PATTERNS) {
    if (pattern.test(loc)) return code
  }
  return null
}

// Indeed's country: the matched one, or 'us' (as before) when there's no
// location, it isn't recognised, or the Indeed actor doesn't list it. Checked
// against misceres/indeed-scraper's input schema (country enum) on 2026-10-08:
// every code above is listed except 'lk'.
const INDEED_UNCONFIRMED = new Set(['lk'])
export function guessCountry(location?: string | null): string {
  const code = matchCountry(location)
  return code && !INDEED_UNCONFIRMED.has(code) ? code : 'us'
}

// Countries Adzuna has an index for.
export const ADZUNA_COUNTRIES = new Set([
  'gb', 'us', 'at', 'au', 'be', 'br', 'ca', 'ch', 'de', 'es',
  'fr', 'in', 'it', 'mx', 'nl', 'nz', 'pl', 'sg', 'za',
])

// Adzuna's index for a location: the matched country when Adzuna covers it,
// null (skip Adzuna) when it names a country Adzuna doesn't cover, and 'gb' (as
// before) when there's no location or it isn't recognised.
export function adzunaCountry(location?: string | null): string | null {
  const code = matchCountry(location)
  if (!code) return 'gb'
  return ADZUNA_COUNTRIES.has(code) ? code : null
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  gb: '£', us: '$', ca: 'C$', au: 'A$', nz: 'NZ$', in: '₹', sg: 'S$', za: 'R',
  br: 'R$', mx: 'MX$', pl: 'zł', ch: 'CHF ',
  at: '€', be: '€', de: '€', es: '€', fr: '€', it: '€', nl: '€',
}

export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? ''
}
