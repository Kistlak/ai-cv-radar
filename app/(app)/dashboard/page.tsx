import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { cvs, userApiKeys, searches } from '@/db/schema'
import { eq, desc } from 'drizzle-orm'
import Link from 'next/link'
import { FileText, Key, Search as SearchIcon, ArrowRight, CheckCircle2, XCircle, Sparkles, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [activeCv] = await db
    .select()
    .from(cvs)
    .where(eq(cvs.userId, user.id))
    .orderBy(desc(cvs.createdAt))
    .limit(1)

  const [keys] = await db
    .select()
    .from(userApiKeys)
    .where(eq(userApiKeys.userId, user.id))
    .limit(1)

  const recentSearches = await db
    .select()
    .from(searches)
    .where(eq(searches.userId, user.id))
    .orderBy(desc(searches.createdAt))
    .limit(5)

  const hasAnthropic = Boolean(keys?.anthropicKey)
  const hasApify = Boolean(keys?.apifyToken)
  const hasAdzuna = Boolean(keys?.adzunaAppId && keys?.adzunaAppKey)
  const hasJsearch = Boolean(keys?.rapidapiKey)
  const keyCount = [hasAnthropic, hasApify, hasAdzuna, hasJsearch].filter(Boolean).length
  const canSearch = Boolean(activeCv) && hasAnthropic

  return (
    <div className="space-y-8 animate-in-fade">
      <div>
        <p className="text-sm text-muted-foreground">Welcome back</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
          Your <span className="text-gradient">job radar</span>
        </h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatusCard
          href="/cv"
          icon={FileText}
          title="CV"
          description={activeCv ? 'Uploaded and parsed' : 'Not uploaded yet'}
          status={activeCv ? 'ready' : 'pending'}
          cta={activeCv ? 'View CV' : 'Upload CV'}
          meta={activeCv ? new Date(activeCv.createdAt).toLocaleDateString() : undefined}
        />

        <StatusCard
          href="/settings"
          icon={Key}
          title="API Keys"
          description={`${keyCount} of 4 configured`}
          status={hasAnthropic ? (keyCount >= 2 ? 'ready' : 'partial') : 'pending'}
          cta="Manage Keys"
          extra={
            <div className="mt-3 space-y-1.5 text-xs">
              <KeyRow label="Anthropic" set={hasAnthropic} />
              <KeyRow label="Apify" set={hasApify} />
              <KeyRow label="Adzuna" set={hasAdzuna} />
              <KeyRow label="JSearch" set={hasJsearch} />
            </div>
          }
        />

        <StatusCard
          href="/search"
          icon={SearchIcon}
          title="New Search"
          description={canSearch ? 'Ready to find jobs' : 'Complete setup first'}
          status={canSearch ? 'ready' : 'pending'}
          cta={canSearch ? 'Start Searching' : 'Setup Required'}
          disabled={!canSearch}
          accent={canSearch}
        />
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent Searches</h2>
          {recentSearches.length > 0 && (
            <Link href="/search" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              New search →
            </Link>
          )}
        </div>

        {recentSearches.length === 0 ? (
          <div className="glass rounded-2xl p-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600/10 via-fuchsia-500/10 to-pink-500/10 ring-1 ring-violet-500/20">
              <Sparkles className="h-6 w-6 text-violet-500" />
            </div>
            <p className="mt-4 font-medium">No searches yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload your CV and add an Anthropic key to get started.
            </p>
          </div>
        ) : (
          <div className="glass rounded-2xl divide-y divide-border/50 overflow-hidden">
            {recentSearches.map((s) => (
              <Link
                key={s.id}
                href={s.status === 'complete' ? `/search/${s.id}` : '#'}
                className={cn(
                  'flex items-center justify-between gap-4 px-5 py-4 transition-colors',
                  s.status === 'complete' ? 'hover:bg-accent/50' : 'pointer-events-none'
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{s.query}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{s.location ?? 'Any location'}</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(s.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <StatusBadge status={s.status} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatusCard({
  href, icon: Icon, title, description, status, cta, meta, extra, disabled, accent,
}: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  status: 'ready' | 'pending' | 'partial'
  cta: string
  meta?: string
  extra?: React.ReactNode
  disabled?: boolean
  accent?: boolean
}) {
  const Wrapper = disabled ? 'div' : Link
  return (
    <Wrapper
      href={disabled ? undefined : href}
      className={cn(
        'group glass rounded-2xl p-5 transition-all',
        disabled ? 'opacity-60' : 'hover:shadow-xl hover:-translate-y-0.5',
        accent && 'ring-1 ring-violet-500/30 glow-primary'
      )}
    >
      <div className="flex items-start justify-between">
        <div
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-xl ring-1',
            accent
              ? 'bg-gradient-to-br from-violet-600 via-fuchsia-500 to-pink-500 text-white ring-violet-500/30 shadow-lg shadow-violet-500/20'
              : 'bg-gradient-to-br from-violet-600/10 via-fuchsia-500/10 to-pink-500/10 text-violet-600 dark:text-violet-300 ring-violet-500/20'
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
        <StatusDot status={status} />
      </div>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      {meta && <p className="mt-1 text-xs text-muted-foreground">Uploaded {meta}</p>}
      {extra}
      <div className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
        {cta}
        {!disabled && <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />}
      </div>
    </Wrapper>
  )
}

function StatusDot({ status }: { status: 'ready' | 'pending' | 'partial' }) {
  const classes = {
    ready: 'bg-green-500 shadow-[0_0_12px_theme(colors.green.500)]',
    partial: 'bg-amber-500 shadow-[0_0_12px_theme(colors.amber.500)]',
    pending: 'bg-muted-foreground/40',
  }
  return <div className={cn('h-2 w-2 rounded-full', classes[status])} />
}

function KeyRow({ label, set }: { label: string; set: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      {set ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <XCircle className="h-3.5 w-3.5 text-muted-foreground/40" />
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    complete: { label: 'Complete', className: 'bg-green-500/10 text-green-600 dark:text-green-400 ring-green-500/20' },
    running: { label: 'Running', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20' },
    failed: { label: 'Failed', className: 'bg-red-500/10 text-red-600 dark:text-red-400 ring-red-500/20' },
  }
  const s = config[status] ?? { label: status, className: 'bg-muted text-muted-foreground' }
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1', s.className)}>
      {s.label}
    </span>
  )
}
