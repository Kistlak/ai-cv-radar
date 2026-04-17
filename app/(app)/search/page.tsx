import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { cvs, userApiKeys } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { Search as SearchIcon, MapPin, Briefcase, Sparkles, ArrowRight, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export default async function SearchPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [activeCv] = await db
    .select({ id: cvs.id })
    .from(cvs)
    .where(eq(cvs.userId, user.id))
    .limit(1)

  const [keys] = await db
    .select({ anthropicKey: userApiKeys.anthropicKey })
    .from(userApiKeys)
    .where(eq(userApiKeys.userId, user.id))
    .limit(1)

  const hasCv = Boolean(activeCv)
  const hasAnthropic = Boolean(keys?.anthropicKey)
  const ready = hasCv && hasAnthropic

  return (
    <div className="space-y-8 animate-in-fade">
      <div>
        <p className="text-sm text-muted-foreground">Discover</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
          New <span className="text-gradient">search</span>
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Tell us what you&apos;re looking for. We&apos;ll pull fresh listings from
          LinkedIn, Indeed, Glassdoor, Adzuna, JSearch, and Remotive — then rank
          them against your CV with Claude.
        </p>
      </div>

      {!ready && (
        <div className="glass rounded-2xl p-5 ring-1 ring-amber-500/20">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20">
              <AlertCircle className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm">Finish setup to start searching</p>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {!hasCv && (
                  <li>
                    <Link href="/cv" className="text-violet-600 dark:text-violet-300 hover:underline">
                      Upload a CV
                    </Link>{' '}
                    so we can rank jobs against your profile.
                  </li>
                )}
                {!hasAnthropic && (
                  <li>
                    <Link href="/settings" className="text-violet-600 dark:text-violet-300 hover:underline">
                      Add your Anthropic API key
                    </Link>{' '}
                    — required for parsing and matching.
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="glass rounded-2xl p-6 sm:p-8">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 via-fuchsia-500 to-pink-500 text-white shadow-lg shadow-violet-500/20">
            <SearchIcon className="h-4 w-4" />
          </div>
          <h2 className="font-semibold">Search criteria</h2>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <FieldPreview icon={Briefcase} label="Role / keywords" placeholder="e.g. Senior React Engineer" />
          <FieldPreview icon={MapPin} label="Location" placeholder="Remote, London, EU…" />
        </div>

        <div className="mt-6 rounded-xl border border-dashed border-border/60 p-6 text-center">
          <Sparkles className="mx-auto h-5 w-5 text-violet-500" />
          <p className="mt-2 font-medium text-sm">Search form ships in Phase 6</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Source toggles, salary filters, and live rank preview coming soon.
          </p>
        </div>

        <button
          type="button"
          disabled
          className={cn(
            'mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-opacity',
            'bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-500 text-white opacity-60 cursor-not-allowed'
          )}
        >
          Find matching jobs
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function FieldPreview({
  icon: Icon,
  label,
  placeholder,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  placeholder: string
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="relative mt-1.5">
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <div className="w-full rounded-xl border border-border/60 bg-background/40 pl-9 pr-3 py-2.5 text-sm text-muted-foreground/70">
          {placeholder}
        </div>
      </div>
    </div>
  )
}
