// Builds lib/locations/cities.json: each country's main cities, biggest first,
// for the search Location picker. Run by hand; the output is committed.
//
//   1. Download https://download.geonames.org/export/dump/cities15000.zip
//      (GeoNames, CC BY 4.0: cities with 15,000+ people) and unzip it.
//   2. npx tsx scripts/build-cities.ts path/to/cities15000.txt
//
// A city is dropped when the job sources would read its "City, Country" label
// as another country (matchCountry checks city patterns first, so "Lagos,
// Portugal" would mean Nigeria). tests/unit/locations.test.ts checks this too.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { matchCountry, normalize } from '@/lib/job-sources/country'
import { listCountries } from '@/lib/locations'

const PER_COUNTRY = 25
// Feature codes that aren't a place someone would search jobs in: sections of
// a city (boroughs, neighbourhoods), historical, abandoned or destroyed places.
const SKIP_FEATURES = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH'])
// Parts of a bigger city that GeoNames lists as places of their own, and that
// would crowd that country's list ("country:name", lower case).
const SKIP_NAMES = new Set(['us:brooklyn', 'us:queens', 'us:manhattan', 'us:the bronx', 'us:staten island'])

const file = process.argv[2]
if (!file) {
  console.error('Usage: npx tsx scripts/build-cities.ts path/to/cities15000.txt')
  process.exit(1)
}

// GeoNames columns: 1 name, 7 feature code, 8 country code, 14 population.
const byCountry = new Map<string, Array<{ name: string; population: number }>>()
for (const line of readFileSync(file, 'utf8').split('\n')) {
  const f = line.split('\t')
  if (f.length < 15) continue
  const name = f[1].trim()
  if (!name || name.includes(',') || SKIP_FEATURES.has(f[7])) continue
  const code = f[8].toLowerCase()
  if (SKIP_NAMES.has(`${code}:${name.toLowerCase()}`)) continue
  const list = byCountry.get(code) ?? []
  list.push({ name, population: Number(f[14]) || 0 })
  byCountry.set(code, list)
}

const out: Record<string, string[]> = {}
const dropped: string[] = []
let total = 0
for (const country of [...listCountries()].sort((a, b) => a.code.localeCompare(b.code))) {
  const candidates = (byCountry.get(country.code) ?? []).sort((a, b) => b.population - a.population)
  const seen = new Set<string>()
  const cities: string[] = []
  for (const { name } of candidates) {
    if (cities.length >= PER_COUNTRY) break
    const key = normalize(name)
    if (seen.has(key)) continue
    seen.add(key)
    if (matchCountry(`${name}, ${country.name}`) !== country.code) {
      dropped.push(`${name}, ${country.name}`)
      continue
    }
    cities.push(name)
  }
  if (cities.length > 0) {
    out[country.code] = cities
    total += cities.length
  }
}

const target = join(process.cwd(), 'lib', 'locations', 'cities.json')
writeFileSync(target, JSON.stringify(out) + '\n')
console.log(`Wrote ${total} cities for ${Object.keys(out).length} countries to ${target}`)
console.log(`Dropped ${dropped.length} read as another country:`)
for (const d of dropped) console.log(`  ${d}`)
