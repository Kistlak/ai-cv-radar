import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { searches } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { ArrowLeft, Clock, MapPin, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

export default async function SearchHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [search] = await db
    .select()
    .from(searches)
    .where(and(eq(searches.id, id), eq(searches.userId, user.id)))
    .limit(1)

  if (!search) notFound()

  return (
    <div className="space-y-8 animate-in-fade">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to dashboard
      </Link>

      <div>
        <p className="text-sm text-muted-foreground">Search results</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
          <span className="text-gradient">{search.query}</span>
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" />
            {search.location ?? 'Any location'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            {new Date(search.createdAt).toLocaleString()}
          </span>
          <StatusBadge status={search.status} />
        </div>
      </div>

      <div className="glass rounded-2xl p-10 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600/10 via-fuchsia-500/10 to-pink-500/10 ring-1 ring-violet-500/20">
          <Sparkles className="h-6 w-6 text-violet-500" />
        </div>
        <p className="mt-4 font-semibold">Results table ships in Phase 6</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Ranked jobs with match scores, reasoning, and quick-apply links —
          powered by Claude.
        </p>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, string> = {
    complete: 'bg-green-500/10 text-green-600 dark:text-green-400 ring-green-500/20',
    running: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20',
    failed: 'bg-red-500/10 text-red-600 dark:text-red-400 ring-red-500/20',
  }
  const cls = config[status] ?? 'bg-muted text-muted-foreground'
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1', cls)}>
      {status}
    </span>
  )
}
