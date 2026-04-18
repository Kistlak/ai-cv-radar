import { NextRequest, NextResponse } from 'next/server'

// Photon is a free OSM-based autocomplete service (https://photon.komoot.io).
// No key required. Public rate limits are generous for modest use;
// if we outgrow them, self-host Photon or switch to Mapbox Geocoding.
const PHOTON_URL = 'https://photon.komoot.io/api/'

interface Suggestion {
  label: string
  type: string
}

interface PhotonFeature {
  properties?: {
    name?: string
    city?: string
    state?: string
    country?: string
    countrycode?: string
    osm_value?: string
    type?: string
  }
}

interface CacheEntry {
  at: number
  data: Suggestion[]
}

const CACHE_TTL_MS = 60 * 60 * 1000
const MAX_CACHE_ENTRIES = 500
const cache = new Map<string, CacheEntry>()

function cacheGet(key: string): Suggestion[] | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return entry.data
}

function cacheSet(key: string, data: Suggestion[]) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, { at: Date.now(), data })
}

function formatSuggestion(feat: PhotonFeature): Suggestion | null {
  const p = feat.properties
  if (!p) return null

  const parts: string[] = []
  if (p.name) parts.push(p.name)
  else if (p.city) parts.push(p.city)
  else return null

  if (p.state && p.state !== p.name && p.state !== p.city) parts.push(p.state)
  if (p.country) parts.push(p.country)

  return {
    label: parts.join(', '),
    type: p.osm_value || p.type || 'place',
  }
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  if (q.length < 2) return NextResponse.json({ suggestions: [] })

  const key = q.toLowerCase()
  const cached = cacheGet(key)
  if (cached) return NextResponse.json({ suggestions: cached })

  const photonUrl = new URL(PHOTON_URL)
  photonUrl.searchParams.set('q', q)
  photonUrl.searchParams.set('limit', '5')
  // Bias toward cities/regions/countries — job searches rarely want a specific street.
  photonUrl.searchParams.append('osm_tag', 'place:city')
  photonUrl.searchParams.append('osm_tag', 'place:town')
  photonUrl.searchParams.append('osm_tag', 'place:state')
  photonUrl.searchParams.append('osm_tag', 'place:country')

  try {
    const res = await fetch(photonUrl.toString(), {
      headers: { 'User-Agent': 'ai-cv-radar/1.0 (location-autocomplete)' },
    })
    if (!res.ok) {
      console.error('[location-suggest] photon', res.status)
      return NextResponse.json({ suggestions: [] })
    }
    const body = (await res.json()) as { features?: PhotonFeature[] }
    const features = Array.isArray(body.features) ? body.features : []

    const seen = new Set<string>()
    const suggestions: Suggestion[] = []
    for (const feat of features) {
      const s = formatSuggestion(feat)
      if (!s) continue
      if (seen.has(s.label)) continue
      seen.add(s.label)
      suggestions.push(s)
    }

    cacheSet(key, suggestions)
    return NextResponse.json({ suggestions })
  } catch (err) {
    console.error('[location-suggest] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ suggestions: [] })
  }
}
