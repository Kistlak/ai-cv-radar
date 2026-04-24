import SearchForm from '@/components/search-form'
import { db } from '@/db'
import { cvs, userApiKeys } from '@/db/schema'
import { createClient } from '@/lib/supabase/server'
import { eq } from 'drizzle-orm'
import { AlertCircle } from 'lucide-react'
import Link from 'next/link'

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
    .select({
      anthropicKey: userApiKeys.anthropicKey,
      apifyToken: userApiKeys.apifyToken,
      adzunaAppId: userApiKeys.adzunaAppId,
      adzunaAppKey: userApiKeys.adzunaAppKey,
      rapidapiKey: userApiKeys.rapidapiKey,
    })
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
          Remotive, Adzuna, JSearch, and LinkedIn - then rank them against your CV with Claude.
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
                    - required for parsing and matching.
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}

      {ready ? (
        <SearchForm
          hasApify={Boolean(keys?.apifyToken)}
          hasAdzuna={Boolean(keys?.adzunaAppId && keys?.adzunaAppKey)}
          hasJsearch={Boolean(keys?.rapidapiKey)}
        />
      ) : (
        <div className="glass rounded-2xl p-8 opacity-50 pointer-events-none select-none">
          <div className="h-10 w-48 rounded-xl bg-muted/60 mb-6" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="h-10 rounded-xl bg-muted/40" />
            <div className="h-10 rounded-xl bg-muted/40" />
          </div>
          <div className="mt-6 h-10 w-full rounded-xl bg-muted/40" />
        </div>
      )}
    </div>
  )
}
