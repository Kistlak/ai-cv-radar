import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { cvs } from '@/db/schema'
import { eq, desc } from 'drizzle-orm'
import { FileText, Upload, User, MapPin, Mail, Sparkles, CheckCircle2 } from 'lucide-react'

export default async function CVPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [activeCv] = await db
    .select()
    .from(cvs)
    .where(eq(cvs.userId, user.id))
    .orderBy(desc(cvs.createdAt))
    .limit(1)

  const structured = activeCv?.structured as Record<string, unknown> | undefined
  const skills = Array.isArray(structured?.skills) ? (structured!.skills as string[]) : []
  const experience = Array.isArray(structured?.experience)
    ? (structured!.experience as Array<Record<string, unknown>>)
    : []

  return (
    <div className="space-y-8 animate-in-fade">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Profile</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
            Your <span className="text-gradient">CV</span>
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            Upload a PDF and we&apos;ll parse it into a structured profile. Your CV
            powers every job match — the better the input, the sharper the radar.
          </p>
        </div>
        {activeCv && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 ring-1 ring-green-500/20 px-3 py-1 text-xs font-medium">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Parsed {new Date(activeCv.createdAt).toLocaleDateString()}
          </span>
        )}
      </div>

      <div className="glass rounded-2xl p-10 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600/10 via-fuchsia-500/10 to-pink-500/10 ring-1 ring-violet-500/20">
          <Upload className="h-7 w-7 text-violet-500" />
        </div>
        <p className="mt-5 font-semibold">CV uploader coming in Phase 3</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Drag & drop a PDF, or paste raw text — Claude will extract skills,
          experience, and education.
        </p>
      </div>

      {structured && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="glass rounded-2xl p-5 lg:col-span-1">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600/20 via-fuchsia-500/20 to-pink-500/20 text-violet-600 dark:text-violet-300 ring-1 ring-violet-500/20">
                <User className="h-4 w-4" />
              </div>
              <h3 className="font-semibold text-sm">Profile</h3>
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              <ProfileRow icon={User} label="Name" value={String(structured.name ?? '—')} />
              <ProfileRow icon={Mail} label="Email" value={String(structured.email ?? '—')} />
              <ProfileRow icon={MapPin} label="Location" value={String(structured.location ?? '—')} />
            </dl>
          </div>

          <div className="glass rounded-2xl p-5 lg:col-span-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600/20 via-fuchsia-500/20 to-pink-500/20 text-violet-600 dark:text-violet-300 ring-1 ring-violet-500/20">
                <Sparkles className="h-4 w-4" />
              </div>
              <h3 className="font-semibold text-sm">Skills</h3>
              {skills.length > 0 && (
                <span className="text-xs text-muted-foreground">({skills.length})</span>
              )}
            </div>
            {skills.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {skills.map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/20 px-2.5 py-1 text-xs font-medium"
                  >
                    {s}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">No skills extracted yet.</p>
            )}
          </div>

          {experience.length > 0 && (
            <div className="glass rounded-2xl p-5 lg:col-span-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600/20 via-fuchsia-500/20 to-pink-500/20 text-violet-600 dark:text-violet-300 ring-1 ring-violet-500/20">
                  <FileText className="h-4 w-4" />
                </div>
                <h3 className="font-semibold text-sm">Experience</h3>
              </div>
              <ul className="mt-4 space-y-3">
                {experience.map((exp, i) => (
                  <li key={i} className="rounded-xl border border-border/50 p-3">
                    <p className="font-medium text-sm">{String(exp.role ?? exp.title ?? 'Role')}</p>
                    <p className="text-xs text-muted-foreground">
                      {String(exp.company ?? '—')}
                      {exp.period ? ` · ${String(exp.period)}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ProfileRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="truncate font-medium">{value}</dd>
      </div>
    </div>
  )
}
