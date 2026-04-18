'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Search, MapPin, Briefcase, ArrowRight, Loader2, Wifi, Sparkles, ListOrdered } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LocSuggestion {
  label: string
  type: string
}

const schema = z.object({
  query: z.string(),
  location: z.string().optional(),
  remoteOnly: z.boolean(),
  sources: z.array(z.string()).min(1, 'Select at least one source'),
  maxResults: z.number().int().nullable(),
})

const JOB_COUNT_OPTIONS: Array<{ value: number | null; label: string }> = [
  { value: 2, label: '2' },
  { value: 5, label: '5' },
  { value: 10, label: '10' },
  { value: null, label: 'All' },
]

type FormValues = z.infer<typeof schema>

interface Source {
  id: string
  label: string
  free: boolean
  available: boolean
}

interface SearchFormProps {
  hasApify: boolean
  hasAdzuna: boolean
  hasJsearch: boolean
}

export default function SearchForm({ hasApify, hasAdzuna, hasJsearch }: SearchFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const sources: Source[] = [
    { id: 'remotive', label: 'Remotive', free: true, available: true },
    { id: 'adzuna', label: 'Adzuna', free: false, available: hasAdzuna },
    { id: 'jsearch', label: 'JSearch', free: false, available: hasJsearch },
    { id: 'linkedin', label: 'LinkedIn', free: false, available: hasApify },
    { id: 'indeed', label: 'Indeed', free: false, available: hasApify },
    { id: 'glassdoor', label: 'Glassdoor', free: false, available: hasApify },
  ]

  const defaultSources = sources.filter((s) => s.available).map((s) => s.id)

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { query: '', location: '', remoteOnly: false, sources: defaultSources, maxResults: 10 },
  })

  const selectedSources = watch('sources')
  const remoteOnly = watch('remoteOnly')
  const query = watch('query')
  const location = watch('location') ?? ''
  const maxResults = watch('maxResults')
  const autoMatch = !query.trim()

  const [locSuggestions, setLocSuggestions] = useState<LocSuggestion[]>([])
  const [locOpen, setLocOpen] = useState(false)
  const [locActive, setLocActive] = useState(-1)
  const suppressFetchRef = useRef(false)
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (suppressFetchRef.current) {
      suppressFetchRef.current = false
      return
    }
    if (remoteOnly || location.trim().length < 2) {
      setLocSuggestions([])
      return
    }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/location-suggest?q=${encodeURIComponent(location.trim())}`,
          { signal: ctrl.signal }
        )
        if (!res.ok) return
        const data = (await res.json()) as { suggestions?: LocSuggestion[] }
        setLocSuggestions(Array.isArray(data.suggestions) ? data.suggestions : [])
        setLocActive(-1)
      } catch {
        /* aborted or network error — ignore */
      }
    }, 200)
    return () => {
      ctrl.abort()
      clearTimeout(t)
    }
  }, [location, remoteOnly])

  function pickSuggestion(s: LocSuggestion) {
    suppressFetchRef.current = true
    setValue('location', s.label, { shouldValidate: true })
    setLocOpen(false)
    setLocSuggestions([])
    setLocActive(-1)
  }

  function onLocationKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!locOpen || locSuggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setLocActive((i) => (i + 1) % locSuggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setLocActive((i) => (i <= 0 ? locSuggestions.length - 1 : i - 1))
    } else if (e.key === 'Enter' && locActive >= 0) {
      e.preventDefault()
      pickSuggestion(locSuggestions[locActive])
    } else if (e.key === 'Escape') {
      setLocOpen(false)
    }
  }

  function toggleSource(id: string) {
    const next = selectedSources.includes(id)
      ? selectedSources.filter((s) => s !== id)
      : [...selectedSources, id]
    setValue('sources', next, { shouldValidate: true })
  }

  async function onSubmit(values: FormValues) {
    setLoading(true)
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to start search')
        return
      }
      router.push(`/search/${data.searchId}`)
    } catch {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="glass rounded-2xl p-6 sm:p-8 space-y-6">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 via-fuchsia-500 to-pink-500 text-white shadow-lg shadow-violet-500/20">
          <Search className="h-4 w-4" />
        </div>
        <h2 className="font-semibold">Search criteria</h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            Role / keywords
            <span className="text-[10px] font-normal text-muted-foreground/70">(optional)</span>
          </label>
          <div className="relative mt-1.5">
            <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              {...register('query')}
              placeholder="Leave blank to auto-match from your CV"
              className={cn(
                'w-full rounded-xl border bg-background/40 pl-9 pr-3 py-2.5 text-sm outline-none transition-colors',
                'placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-violet-500/40',
                'border-border/60'
              )}
            />
          </div>
          {autoMatch && (
            <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-300">
              <Sparkles className="h-3 w-3" />
              We&apos;ll pick the best query from your CV
            </p>
          )}
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Location</label>
          <div className="relative mt-1.5">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              {...register('location')}
              placeholder="Remote, London, New York…"
              disabled={remoteOnly}
              autoComplete="off"
              onFocus={() => setLocOpen(true)}
              onBlur={() => {
                if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
                blurTimerRef.current = setTimeout(() => setLocOpen(false), 150)
              }}
              onKeyDown={onLocationKeyDown}
              className={cn(
                'w-full rounded-xl border bg-background/40 pl-9 pr-3 py-2.5 text-sm outline-none transition-colors',
                'placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-violet-500/40',
                'border-border/60 disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            />
            {locOpen && locSuggestions.length > 0 && !remoteOnly && (
              <ul
                role="listbox"
                className="absolute z-10 mt-1 w-full rounded-xl border border-border/60 bg-background/95 backdrop-blur shadow-lg ring-1 ring-black/5 overflow-hidden"
              >
                {locSuggestions.map((s, i) => (
                  <li
                    key={`${s.label}-${i}`}
                    role="option"
                    aria-selected={i === locActive}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      pickSuggestion(s)
                    }}
                    onMouseEnter={() => setLocActive(i)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 text-sm cursor-pointer',
                      i === locActive ? 'bg-violet-600/10 text-violet-700 dark:text-violet-200' : 'hover:bg-muted/40'
                    )}
                  >
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">{s.label}</span>
                    <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground/70">{s.type}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={remoteOnly}
            onClick={() => setValue('remoteOnly', !remoteOnly)}
            className={cn(
              'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
              remoteOnly ? 'bg-violet-600' : 'bg-muted'
            )}
          >
            <span
              className={cn(
                'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
                remoteOnly ? 'translate-x-4' : 'translate-x-0'
              )}
            />
          </button>
          <label className="text-sm font-medium cursor-pointer select-none flex items-center gap-1.5" onClick={() => setValue('remoteOnly', !remoteOnly)}>
            <Wifi className="h-3.5 w-3.5 text-muted-foreground" />
            Remote only
          </label>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium flex items-center gap-1.5">
            <ListOrdered className="h-3.5 w-3.5 text-muted-foreground" />
            Jobs
          </span>
          <div className="inline-flex rounded-lg ring-1 ring-border/60 bg-background/40 p-0.5">
            {JOB_COUNT_OPTIONS.map((opt) => {
              const selected = maxResults === opt.value
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setValue('maxResults', opt.value, { shouldValidate: true })}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    selected
                      ? 'bg-violet-600/15 text-violet-600 dark:text-violet-300'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">Sources</p>
        <div className="flex flex-wrap gap-2">
          {sources.map((source) => {
            const selected = selectedSources.includes(source.id)
            return (
              <button
                key={source.id}
                type="button"
                disabled={!source.available}
                onClick={() => source.available && toggleSource(source.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ring-1 transition-all',
                  source.available
                    ? selected
                      ? 'bg-violet-600/15 text-violet-600 dark:text-violet-300 ring-violet-500/40'
                      : 'bg-background/40 text-muted-foreground ring-border/60 hover:ring-border'
                    : 'opacity-40 cursor-not-allowed bg-background/20 text-muted-foreground ring-border/30'
                )}
              >
                {source.label}
                {source.free && (
                  <span className="rounded-full bg-green-500/15 text-green-600 dark:text-green-400 px-1.5 py-0.5 text-[10px] font-semibold">free</span>
                )}
                {!source.available && !source.free && (
                  <span className="text-[10px] text-muted-foreground/60">no key</span>
                )}
              </button>
            )
          })}
        </div>
        {errors.sources && <p className="mt-1 text-xs text-destructive">{errors.sources.message}</p>}
      </div>

      <button
        type="submit"
        disabled={loading}
        className={cn(
          'inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all',
          'bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-500 text-white shadow-lg shadow-violet-500/25',
          'hover:shadow-violet-500/40 hover:scale-[1.01] active:scale-100',
          loading && 'opacity-70 cursor-not-allowed hover:scale-100'
        )}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Starting search…
          </>
        ) : autoMatch ? (
          <>
            <Sparkles className="h-4 w-4" />
            Auto-match from my CV
          </>
        ) : (
          <>
            Find matching jobs
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
    </form>
  )
}
