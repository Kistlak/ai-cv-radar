'use client'

import { Combobox } from '@base-ui/react/combobox'
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill'
import { Check, ChevronDown, MapPin, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { normalize } from '@/lib/job-sources/country'
import {
  citiesFor,
  countryByCode,
  fromLocation,
  listCountries,
  matchesCity,
  matchesCountry,
  MAX_CITY_LENGTH,
  toLocation,
  type Country,
} from '@/lib/locations'

// Country, then city. The parent still gets one location string ("Colombo,
// Sri Lanka", "Sri Lanka" or ""), so the search API is unchanged.

type CityOption = { kind: 'any' } | { kind: 'city'; name: string } | { kind: 'custom'; name: string }

const ANYWHERE: CityOption = { kind: 'any' }

// Windows draws flag emoji as letters ("LK"); the polyfill loads a flags-only
// font, and only on browsers that need it.
const FLAG_FONT = "'Twemoji Country Flags'"

const inputClass = cn(
  'w-full rounded-xl border bg-background/40 py-2.5 text-sm outline-none transition-colors',
  'placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-violet-500/40',
  'border-border/60 disabled:opacity-50 disabled:cursor-not-allowed'
)
const popupClass =
  'z-50 max-h-72 w-[var(--anchor-width)] overflow-y-auto rounded-xl border border-border/60 bg-background/95 backdrop-blur shadow-lg ring-1 ring-black/5 py-1'
const itemClass = cn(
  'flex items-center gap-2 px-3 py-2 text-sm cursor-pointer select-none',
  'data-[highlighted]:bg-violet-600/10 data-[highlighted]:text-violet-700 dark:data-[highlighted]:text-violet-200'
)

function Flag({ country }: { country: Country }) {
  return (
    <span aria-hidden style={{ fontFamily: `${FLAG_FONT}, sans-serif` }}>
      {country.flag}
    </span>
  )
}

interface LocationPickerProps {
  // The starting location, e.g. the CV's. Split into country and city.
  initialLocation?: string
  disabled?: boolean
  onChange: (location: string) => void
}

export function LocationPicker({ initialLocation, disabled, onChange }: LocationPickerProps) {
  const initial = useMemo(() => fromLocation(initialLocation), [initialLocation])
  const [countryCode, setCountryCode] = useState<string | undefined>(initial.countryCode)
  const [city, setCity] = useState<string | undefined>(initial.city)
  const [cityQuery, setCityQuery] = useState('')

  useEffect(() => {
    polyfillCountryFlagEmojis()
  }, [])

  const countries = listCountries()
  const country = countryByCode(countryCode) ?? null
  const cities = citiesFor(countryCode)

  function update(nextCountry: string | undefined, nextCity: string | undefined) {
    setCountryCode(nextCountry)
    setCity(nextCity)
    onChange(toLocation(nextCountry, nextCity))
  }

  const cityLabel = (o: CityOption) => (o.kind === 'any' ? `Anywhere in ${country?.name ?? ''}` : o.name)
  const cityValue: CityOption | null = !country
    ? null
    : !city
      ? ANYWHERE
      : cities.some((c) => c === city)
        ? { kind: 'city', name: city }
        : { kind: 'custom', name: city }

  // "Use “…”" for a town that isn't listed, while the typed text isn't a listed
  // city or the current choice.
  const typed = cityQuery.trim()
  const showCustom =
    Boolean(country) &&
    typed !== '' &&
    !cities.some((c) => normalize(c) === normalize(typed)) &&
    (!cityValue || normalize(cityLabel(cityValue)) !== normalize(typed))
  const cityItems: CityOption[] = [
    ANYWHERE,
    ...cities.map((name): CityOption => ({ kind: 'city', name })),
    ...(cityValue?.kind === 'custom' ? [cityValue] : []),
    ...(showCustom ? [{ kind: 'custom', name: typed } as CityOption] : []),
  ]

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Combobox.Root<Country>
        items={countries}
        value={country}
        onValueChange={(next) => update(next?.code, undefined)}
        itemToStringLabel={(c) => c.name}
        itemToStringValue={(c) => c.code}
        isItemEqualToValue={(a, b) => a.code === b.code}
        filter={matchesCountry}
        disabled={disabled}
        autoHighlight
      >
        <div className="relative">
          {country ? (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm">
              <Flag country={country} />
            </span>
          ) : (
            <MapPin className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          )}
          <Combobox.Input
            placeholder="Any country"
            aria-label="Country"
            className={cn(inputClass, 'pl-9 pr-14')}
          />
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
            {country && (
              <Combobox.Clear
                aria-label="Clear location"
                className="rounded-md p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </Combobox.Clear>
            )}
            <Combobox.Trigger aria-label="Show countries" className="rounded-md p-1 text-muted-foreground">
              <ChevronDown className="h-3.5 w-3.5" />
            </Combobox.Trigger>
          </div>
        </div>
        <Combobox.Portal>
          <Combobox.Positioner sideOffset={4}>
            <Combobox.Popup className={popupClass}>
              <Combobox.Empty className="px-3 py-2 text-sm text-muted-foreground empty:hidden">
                No country matches
              </Combobox.Empty>
              <Combobox.List>
                {(c: Country) => (
                  <Combobox.Item key={c.code} value={c} className={itemClass}>
                    <Flag country={c} />
                    <span className="truncate">{c.name}</span>
                    <Combobox.ItemIndicator className="ml-auto">
                      <Check className="h-3.5 w-3.5" />
                    </Combobox.ItemIndicator>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>

      <Combobox.Root<CityOption>
        items={cityItems}
        value={cityValue}
        onValueChange={(next) => update(countryCode, next && next.kind !== 'any' ? next.name : undefined)}
        onInputValueChange={setCityQuery}
        itemToStringLabel={cityLabel}
        itemToStringValue={cityLabel}
        isItemEqualToValue={(a, b) => a.kind === b.kind && cityLabel(a) === cityLabel(b)}
        filter={(o, query) => o.kind !== 'city' || matchesCity(o.name, query)}
        disabled={disabled || !country}
        autoHighlight
      >
        <div className="relative">
          <Combobox.Input
            placeholder={country ? `Anywhere in ${country.name}` : 'Choose a country first'}
            aria-label="City"
            maxLength={MAX_CITY_LENGTH}
            className={cn(inputClass, 'pl-3 pr-8')}
          />
          <Combobox.Trigger
            aria-label="Show cities"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Combobox.Trigger>
        </div>
        <Combobox.Portal>
          <Combobox.Positioner sideOffset={4}>
            <Combobox.Popup className={popupClass}>
              <Combobox.List>
                {(o: CityOption) => (
                  <Combobox.Item key={`${o.kind}:${cityLabel(o)}`} value={o} className={itemClass}>
                    <span className={cn('truncate', o.kind === 'any' && 'font-medium')}>
                      {o.kind === 'custom' && o.name === typed && showCustom ? `Use “${o.name}”` : cityLabel(o)}
                    </span>
                    <Combobox.ItemIndicator className="ml-auto">
                      <Check className="h-3.5 w-3.5" />
                    </Combobox.ItemIndicator>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </div>
  )
}
