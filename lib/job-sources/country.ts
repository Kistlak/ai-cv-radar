// Maps a free-text search location to a 2-letter country code, shared by the
// sources that query a per-country index (Indeed via Apify, Adzuna).

// Checked before every country name, in order: the first match wins. Cities,
// aliases and names the ISO list below gets wrong for job searches.
const COUNTRY_PATTERNS: Array<[code: string, pattern: RegExp]> = [
  // US states and places that contain another country's name.
  ['us', /\b(new mexico|new jersey|jersey city)\b/],
  ['au', /\b(new south wales)\b/],
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
  // Aliases and old names.
  ['gb', /\b(great britain|britain)\b/],
  ['us', /\b(us|u\.s)\b/],
  ['tr', /\b(turkey)\b/],
  ['cz', /\b(czech republic)\b/],
  ['ci', /\b(ivory coast)\b/],
  ['nl', /\b(holland)\b/],
  ['kr', /(?<!north )\bkorea\b/],
  ['mm', /\b(burma)\b/],
  ['sz', /\b(swaziland)\b/],
  ['mk', /\b(macedonia)\b/],
  ['cv', /\b(cape verde)\b/],
  ['tl', /\b(east timor)\b/],
  ['cd', /\b(drc|dr congo|democratic republic of (the )?congo|kinshasa)\b/],
  ['cg', /\b(congo|brazzaville)\b/],
  // Major cities.
  ['ie', /\b(dublin|cork|galway)\b/],
  ['pt', /\b(lisbon|porto)\b/],
  ['se', /\b(stockholm|gothenburg|malmo)\b/],
  ['no', /\b(oslo|bergen)\b/],
  ['dk', /\b(copenhagen|aarhus)\b/],
  ['fi', /\b(helsinki|espoo|tampere)\b/],
  ['cz', /\b(prague|brno)\b/],
  ['ro', /\b(bucharest|cluj)\b/],
  ['hu', /\b(budapest)\b/],
  ['gr', /\b(athens|thessaloniki)\b/],
  ['ua', /\b(kyiv|kiev|lviv|kharkiv)\b/],
  ['tr', /\b(istanbul|ankara|izmir)\b/],
  ['il', /\b(tel aviv|jerusalem|haifa)\b/],
  ['eg', /\b(cairo|giza)\b/],
  ['ma', /\b(casablanca|rabat)\b/],
  ['ng', /\b(lagos|abuja)\b/],
  ['ke', /\b(nairobi|mombasa)\b/],
  ['gh', /\b(accra|kumasi)\b/],
  ['pk', /\b(karachi|lahore|islamabad)\b/],
  ['bd', /\b(dhaka|chittagong)\b/],
  ['ph', /\b(manila|makati|cebu)\b/],
  ['vn', /\b(hanoi|ho chi minh|saigon)\b/],
  ['id', /\b(jakarta|surabaya|bali)\b/],
  ['my', /\b(kuala lumpur|penang)\b/],
  ['th', /\b(bangkok|chiang mai)\b/],
  ['jp', /\b(tokyo|osaka|kyoto)\b/],
  ['kr', /\b(seoul|busan)\b/],
  ['cn', /\b(beijing|shanghai|shenzhen|guangzhou)\b/],
  ['tw', /\b(taipei)\b/],
  ['sa', /\b(riyadh|jeddah|dammam)\b/],
  ['qa', /\b(doha)\b/],
  ['bh', /\b(manama)\b/],
  ['om', /\b(muscat)\b/],
  ['ar', /\b(buenos aires)\b/],
  ['cl', /\b(santiago)\b/],
  ['co', /\b(bogota|medellin)\b/],
  ['pe', /\b(lima)\b/],
  ['uy', /\b(montevideo)\b/],
  ['ec', /\b(quito|guayaquil)\b/],
  ['ru', /\b(moscow)\b/],
  ['ca', /\b(calgary|ottawa|edmonton)\b/],
  ['au', /\b(brisbane|perth|adelaide)\b/],
  ['de', /\b(hamburg|frankfurt|cologne)\b/],
  ['in', /\b(pune|chennai|kolkata|bengaluru|gurgaon|noida)\b/],
  ['us', /\b(atlanta|denver|miami|dallas|houston|washington dc)\b/],
]

// Region codes Intl names that aren't countries, or are old codes for a
// country listed under its current code. Congo's two names ("Congo -
// Kinshasa") are matched by the patterns above instead.
const NOT_COUNTRIES = new Set([
  'EU', 'EZ', 'UN', 'QO', 'ZZ', 'XA', 'XB', 'AC', 'CP', 'DG', 'EA', 'IC', 'TA',
  'AN', 'BU', 'CS', 'DD', 'DY', 'FX', 'HV', 'NH', 'NT', 'RH', 'SU', 'TP', 'UK',
  'VD', 'YD', 'YU', 'ZR', 'CD', 'CG',
])

// Lower case without accents, so "São Paulo" and "Sao Paulo" match alike, and
// "&" read as "and".
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/ & /g, ' and ')
}

// The spellings a location might use for an Intl country name.
function nameVariants(name: string): string[] {
  const base = normalize(name)
    .replace(/\s*\(.*\)/, '')
    .replace(/ sar china$/, '')
  if (!base.startsWith('st. ')) return [base]
  const rest = base.slice(4)
  return [`saint ${rest}`, `st ${rest}`, `st. ${rest}`]
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Every country Intl names in English, as [lower-case code, name], minus
// NOT_COUNTRIES. Built on first use from Intl, so no list to maintain. The
// location picker (lib/locations) lists the same countries, so they can't drift.
let intlCountries: Array<[code: string, name: string]> | null = null

export function intlCountryNames(): Array<[code: string, name: string]> {
  if (intlCountries) return intlCountries
  const display = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' })
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const names: Array<[code: string, name: string]> = []
  for (const a of letters) {
    for (const b of letters) {
      const code = a + b
      if (NOT_COUNTRIES.has(code)) continue
      const name = display.of(code)
      if (name && name !== code) names.push([code.toLowerCase(), name])
    }
  }
  intlCountries = names
  return intlCountries
}

// Every country's English name, longest first so "Papua New Guinea" wins over
// "Guinea".
let countryNames: Array<[code: string, pattern: RegExp]> | null = null

function getCountryNames(): Array<[code: string, pattern: RegExp]> {
  if (countryNames) return countryNames
  const names: Array<[code: string, variants: string[]]> = intlCountryNames().map(([code, name]) => [
    code,
    nameVariants(name),
  ])
  names.sort((x, y) => y[1][0].length - x[1][0].length)
  countryNames = names.map(([code, variants]) => [
    code,
    new RegExp(`\\b(${variants.map(escapeRegExp).join('|')})\\b`),
  ])
  return countryNames
}

// The country a location names, or null when it isn't recognised.
export function matchCountry(location?: string | null): string | null {
  if (!location) return null
  const loc = normalize(location)
  for (const [code, pattern] of COUNTRY_PATTERNS) {
    if (pattern.test(loc)) return code
  }
  for (const [code, pattern] of getCountryNames()) {
    if (pattern.test(loc)) return code
  }
  return null
}

// Indeed's country: the matched one, or 'us' (as before) when there's no
// location, it isn't recognised, or the Indeed actor doesn't list it. The list
// is misceres/indeed-scraper's `country` enum, read from build 0.0.117's input
// schema on 2026-10-14.
const INDEED_COUNTRIES = new Set([
  'aq', 'ar', 'au', 'at', 'bh', 'be', 'br', 'ca', 'cl', 'cn', 'co', 'cr', 'cz',
  'dk', 'ec', 'eg', 'fi', 'fr', 'de', 'gr', 'hk', 'hu', 'in', 'id', 'ie', 'il',
  'it', 'jp', 'kw', 'lu', 'mx', 'ma', 'nl', 'nz', 'ng', 'no', 'om', 'pk', 'pa',
  'pe', 'ph', 'pl', 'pt', 'qa', 'ro', 'sa', 'sg', 'za', 'kr', 'es', 'se', 'ch',
  'tw', 'th', 'tr', 'ua', 'ae', 'gb', 'us', 'uy', 've', 'vn',
])
export function guessCountry(location?: string | null): string {
  const code = matchCountry(location)
  return code && INDEED_COUNTRIES.has(code) ? code : 'us'
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
