import { describe, expect, it } from 'vitest'
import { matchCountry } from '@/lib/job-sources/country'
import {
  citiesFor,
  filterCities,
  filterCountries,
  fromLocation,
  listCountries,
  matchesCity,
  matchesCountry,
  MAX_CITY_LENGTH,
  toLocation,
} from '@/lib/locations'

describe('listCountries', () => {
  it('lists every country A–Z with clean names and flags', () => {
    const countries = listCountries()
    const names = countries.map((c) => c.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')))
    expect(countries.find((c) => c.code === 'lk')).toEqual({ code: 'lk', name: 'Sri Lanka', flag: '🇱🇰' })
    expect(names).toContain('United Kingdom')
    expect(names).toContain('United States')
    expect(names).toContain('Hong Kong') // not "Hong Kong SAR China"
    expect(names).toContain('Myanmar') // not "Myanmar (Burma)"
    expect(names).toContain('DR Congo')
    expect(names).toContain('Congo')
  })

  it('leaves out regions that are not countries', () => {
    const codes = listCountries().map((c) => c.code)
    for (const code of ['eu', 'un', 'zz', 'uk']) expect(codes).not.toContain(code)
  })
})

// The picker's value goes to the job sources as text, which read the country
// back with matchCountry. Every option has to come back as itself.
describe('round trip through matchCountry', () => {
  it('reads every country name as that country', () => {
    const wrong = listCountries()
      .filter((c) => matchCountry(toLocation(c.code)) !== c.code)
      .map((c) => `${c.name} → ${matchCountry(c.name)}`)
    expect(wrong).toEqual([])
  })

  it('reads every listed "City, Country" as that country', () => {
    const wrong: string[] = []
    for (const c of listCountries()) {
      for (const city of citiesFor(c.code)) {
        const location = toLocation(c.code, city)
        if (matchCountry(location) !== c.code) wrong.push(`${location} → ${matchCountry(location)}`)
      }
    }
    expect(wrong).toEqual([])
  })
})

describe('citiesFor', () => {
  it("lists a country's main cities, biggest first", () => {
    expect(citiesFor('lk')[0]).toBe('Colombo')
    expect(citiesFor('gb').slice(0, 2)).toEqual(['London', 'Birmingham'])
    expect(citiesFor('gb').length).toBeLessThanOrEqual(25)
  })

  it('returns nothing for no country or an unknown one', () => {
    expect(citiesFor(undefined)).toEqual([])
    expect(citiesFor('zz')).toEqual([])
  })
})

describe('toLocation', () => {
  it('builds "City, Country", "Country" or nothing', () => {
    expect(toLocation('lk', 'Colombo')).toBe('Colombo, Sri Lanka')
    expect(toLocation('lk')).toBe('Sri Lanka')
    expect(toLocation('lk', '  ')).toBe('Sri Lanka')
    expect(toLocation(undefined, 'Colombo')).toBe('')
  })

  it('caps a typed town so the location fits the search limit', () => {
    const location = toLocation('lk', 'x'.repeat(200))
    expect(location).toBe(`${'x'.repeat(MAX_CITY_LENGTH)}, Sri Lanka`)
    expect(location.length).toBeLessThanOrEqual(100)
  })
})

describe('fromLocation', () => {
  it('splits a CV location into a country and a city', () => {
    expect(fromLocation('Colombo, Sri Lanka')).toEqual({ countryCode: 'lk', city: 'Colombo' })
    expect(fromLocation('London, UK')).toEqual({ countryCode: 'gb', city: 'London' })
    expect(fromLocation('Sri Lanka')).toEqual({ countryCode: 'lk' })
  })

  it('keeps a town that is not listed, and uses the listed spelling when it is', () => {
    expect(fromLocation('Hikkaduwa, Sri Lanka')).toEqual({ countryCode: 'lk', city: 'Hikkaduwa' })
    expect(fromLocation('sao paulo, Brazil')).toEqual({ countryCode: 'br', city: 'São Paulo' })
  })

  it('finds the country of a town given alone when only one country lists it', () => {
    expect(fromLocation('Kandy')).toEqual({ countryCode: 'lk', city: 'Kandy' })
    expect(fromLocation('kandy, Central Province')).toEqual({ countryCode: 'lk', city: 'Kandy' })
    expect(fromLocation('Hamilton')).toEqual({}) // Bermuda, Canada and New Zealand
    expect(fromLocation('Remote')).toEqual({})
  })

  it('keeps a listed city given alone', () => {
    expect(fromLocation('London')).toEqual({ countryCode: 'gb', city: 'London' })
    expect(fromLocation('Sri Lanka')).toEqual({ countryCode: 'lk' })
  })

  it('returns nothing when no country is recognised', () => {
    expect(fromLocation('Atlantis')).toEqual({})
    expect(fromLocation('')).toEqual({})
    expect(fromLocation(undefined)).toEqual({})
  })
})

describe('filters', () => {
  it('matches countries by name, code and common aliases', () => {
    const names = (q: string) => filterCountries(listCountries(), q).map((c) => c.name)
    expect(names('sri')).toContain('Sri Lanka')
    expect(names('uk')).toContain('United Kingdom')
    expect(names('usa')).toContain('United States')
    expect(names('uae')).toContain('United Arab Emirates')
    expect(names('cote')).toContain('Côte d’Ivoire')
    expect(filterCountries(listCountries(), '')).toHaveLength(listCountries().length)
  })

  it('matches one option at a time, as the picker filters', () => {
    const lk = listCountries().find((c) => c.code === 'lk')!
    expect(matchesCountry(lk, 'lanka')).toBe(true)
    expect(matchesCountry(lk, '')).toBe(true)
    expect(matchesCountry(lk, 'india')).toBe(false)
    expect(matchesCity('São Paulo', 'SAO')).toBe(true)
    expect(matchesCity('Kandy', 'galle')).toBe(false)
  })

  it('matches cities ignoring case and accents', () => {
    expect(filterCities(['São Paulo', 'Rio de Janeiro'], 'sao')).toEqual(['São Paulo'])
    expect(filterCities(['Colombo', 'Kandy'], 'KAN')).toEqual(['Kandy'])
  })
})
