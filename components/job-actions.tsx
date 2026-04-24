'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  AlertCircle,
  Bot,
  Check,
  CircleAlert,
  CircleCheck,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FileUser,
  ImageIcon,
  Lightbulb,
  Loader2,
  Puzzle,
  RefreshCw,
  Rocket,
  Sparkles,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

interface DeepDive {
  fitSummary: string
  strengths: string[]
  gaps: string[]
  emphasis: string[]
}

interface TailoredCv {
  name: string
  title: string
  summary: string
  skills: string[]
  experience: Array<{ company: string; title: string; bullets: string[] }>
}

interface JobActionsProps {
  jobId: string
  jobTitle: string
  company: string
  applyUrl?: string
}

export function JobActions({ jobId, jobTitle, company, applyUrl }: JobActionsProps) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <DeepDiveButton jobId={jobId} jobTitle={jobTitle} company={company} />
      <CoverLetterButton jobId={jobId} jobTitle={jobTitle} company={company} />
      <TailoredCvButton jobId={jobId} jobTitle={jobTitle} company={company} />
      {applyUrl && (
        <AutoApplyButton
          jobId={jobId}
          jobTitle={jobTitle}
          company={company}
          applyUrl={applyUrl}
        />
      )}
    </div>
  )
}

function DeepDiveButton({ jobId, jobTitle, company }: JobActionsProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<DeepDive | null>(null)

  const load = useCallback(
    async (force = false) => {
      if (!force && (data || loading)) return
      if (force) setRegenerating(true)
      else setLoading(true)
      setError(null)
      try {
        const url = `/api/jobs/${jobId}/deep-dive${force ? '?regenerate=1' : ''}`
        const res = await fetch(url, { method: 'POST' })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error ?? 'Failed to generate deep-dive')
        setData(body.deepDive as DeepDive)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
        setRegenerating(false)
      }
    },
    [jobId, data, loading]
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) load()
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Sparkles />
            Deep dive
          </Button>
        }
      />
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>AI deep-dive</DialogTitle>
          <DialogDescription>
            {jobTitle} · {company}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
            Analyzing your CV against this job…
          </div>
        )}

        {error && !loading && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 ring-1 ring-destructive/20 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">Couldn&apos;t generate deep-dive</p>
              <p className="mt-0.5 opacity-80">{error}</p>
              <button
                onClick={() => {
                  setError(null)
                  setData(null)
                  load()
                }}
                className="mt-2 text-[11px] font-semibold underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {data && !loading && (
          <div className="space-y-4 text-sm">
            <p className="rounded-lg bg-violet-500/5 ring-1 ring-violet-500/10 px-3 py-2 text-foreground leading-relaxed">
              {data.fitSummary}
            </p>
            <Section
              icon={<CircleCheck className="h-3.5 w-3.5 text-green-500" />}
              title="Strengths"
              items={data.strengths}
              tone="green"
            />
            <Section
              icon={<CircleAlert className="h-3.5 w-3.5 text-amber-500" />}
              title="Gaps"
              items={data.gaps}
              tone="amber"
            />
            <Section
              icon={<Lightbulb className="h-3.5 w-3.5 text-violet-500" />}
              title="What to emphasize"
              items={data.emphasis}
              tone="violet"
            />
            <div className="flex justify-end pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => load(true)}
                disabled={regenerating}
              >
                {regenerating ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RefreshCw />
                )}
                {regenerating ? 'Regenerating…' : 'Regenerate'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Section({
  icon,
  title,
  items,
  tone,
}: {
  icon: React.ReactNode
  title: string
  items: string[]
  tone: 'green' | 'amber' | 'violet'
}) {
  if (!items.length) return null
  const dot =
    tone === 'green' ? 'bg-green-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-violet-500'
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </div>
      <ul className="mt-2 space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-foreground/90">
            <span className={cn('mt-1.5 h-1 w-1 shrink-0 rounded-full', dot)} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CoverLetterButton({ jobId, jobTitle, company }: JobActionsProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [letter, setLetter] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(
    async (force = false) => {
      if (!force && (letter || loading)) return
      if (force) setRegenerating(true)
      else setLoading(true)
      setError(null)
      try {
        const url = `/api/jobs/${jobId}/cover-letter${force ? '?regenerate=1' : ''}`
        const res = await fetch(url, { method: 'POST' })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error ?? 'Failed to draft cover letter')
        setLetter(body.coverLetter as string)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
        setRegenerating(false)
      }
    },
    [jobId, letter, loading]
  )

  const copy = useCallback(async () => {
    if (!letter) return
    try {
      await navigator.clipboard.writeText(letter)
      setCopied(true)
      toast.success('Cover letter copied')
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.error('Copy failed - select the text manually')
    }
  }, [letter])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) load()
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <FileText />
            Cover letter
          </Button>
        }
      />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Drafted cover letter</DialogTitle>
          <DialogDescription>
            {jobTitle} · {company}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
            Drafting your letter…
          </div>
        )}

        {error && !loading && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 ring-1 ring-destructive/20 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">Couldn&apos;t draft the letter</p>
              <p className="mt-0.5 opacity-80">{error}</p>
              <button
                onClick={() => {
                  setError(null)
                  setLetter(null)
                  load()
                }}
                className="mt-2 text-[11px] font-semibold underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {letter && !loading && (
          <div className="space-y-3">
            <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/40 ring-1 ring-border/40 px-4 py-3 text-sm leading-relaxed text-foreground">
              {letter}
            </div>
            <div className="flex justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => load(true)}
                disabled={regenerating}
              >
                {regenerating ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RefreshCw />
                )}
                {regenerating ? 'Regenerating…' : 'Regenerate'}
              </Button>
              <Button onClick={copy} size="sm">
                {copied ? <Check /> : <Copy />}
                {copied ? 'Copied' : 'Copy to clipboard'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function TailoredCvButton({ jobId, jobTitle, company }: JobActionsProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cv, setCv] = useState<TailoredCv | null>(null)
  const [withPhoto, setWithPhoto] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const load = useCallback(
    async (force = false) => {
      if (!force && (cv || loading)) return
      if (force) setRegenerating(true)
      else setLoading(true)
      setError(null)
      try {
        const url = `/api/jobs/${jobId}/tailored-cv${force ? '?regenerate=1' : ''}`
        const res = await fetch(url, { method: 'POST' })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error ?? 'Failed to generate tailored CV')
        setCv(body.tailoredCv as TailoredCv)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
        setRegenerating(false)
      }
    },
    [jobId, cv, loading]
  )

  const download = useCallback(async () => {
    setDownloading(true)
    try {
      const res = await fetch(
        `/api/jobs/${jobId}/tailored-cv/download?photo=${withPhoto ? '1' : '0'}`
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Download failed')
      }
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const match = disposition.match(/filename="([^"]+)"/)
      const filename = match?.[1] ?? 'tailored_cv.docx'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('CV downloaded - edit in Word to finish')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }, [jobId, withPhoto])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) load()
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <FileUser />
            Tailor CV
          </Button>
        }
      />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tailored CV</DialogTitle>
          <DialogDescription>
            {jobTitle} · {company}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
            Rewriting your CV for this role…
          </div>
        )}

        {error && !loading && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 ring-1 ring-destructive/20 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">Couldn&apos;t generate tailored CV</p>
              <p className="mt-0.5 opacity-80">{error}</p>
              <button
                onClick={() => {
                  setError(null)
                  setCv(null)
                  load()
                }}
                className="mt-2 text-[11px] font-semibold underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {cv && !loading && (
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/40 ring-1 ring-border/40 px-4 py-3">
              <p className="text-base font-semibold">{cv.name}</p>
              <p className="text-xs text-muted-foreground">{cv.title}</p>
              <p className="mt-2 text-xs leading-relaxed text-foreground/90">{cv.summary}</p>
            </div>

            <div className="max-h-[40vh] overflow-y-auto space-y-3 text-xs">
              {cv.experience.slice(0, 3).map((role, i) => (
                <div key={i} className="rounded-lg ring-1 ring-border/40 px-3 py-2">
                  <p className="font-semibold">
                    {role.title} <span className="text-muted-foreground">- {role.company}</span>
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {role.bullets.slice(0, 3).map((b, j) => (
                      <li key={j} className="flex gap-2 text-foreground/80">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-violet-500" />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {cv.skills.length > 0 && (
                <div className="rounded-lg ring-1 ring-border/40 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Skills
                  </p>
                  <p className="mt-1 text-foreground/80">{cv.skills.slice(0, 15).join(' · ')}</p>
                </div>
              )}
            </div>

            <label className="flex items-center gap-2 rounded-lg bg-violet-500/5 ring-1 ring-violet-500/10 px-3 py-2 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={withPhoto}
                onChange={(e) => setWithPhoto(e.target.checked)}
                className="h-3.5 w-3.5 accent-violet-500"
              />
              <ImageIcon className="h-3.5 w-3.5 text-violet-500" />
              <span className="flex-1">
                <span className="font-medium">Include photo placeholder</span>
                <span className="text-muted-foreground"> - recommended for UAE/EU/DE/FR. Skip for UK/US/CA/AU.</span>
              </span>
            </label>

            <div className="flex justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => load(true)}
                disabled={regenerating}
              >
                {regenerating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {regenerating ? 'Regenerating…' : 'Regenerate'}
              </Button>
              <Button onClick={download} size="sm" disabled={downloading}>
                {downloading ? <Loader2 className="animate-spin" /> : <Download />}
                {downloading ? 'Preparing…' : 'Download .docx'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

interface AutoApplyButtonProps extends JobActionsProps {
  applyUrl: string
}

function AutoApplyButton({ jobId, jobTitle, company, applyUrl }: AutoApplyButtonProps) {
  const [open, setOpen] = useState(false)
  const [extensionStatus, setExtensionStatus] = useState<'unknown' | 'installed' | 'missing'>(
    'unknown'
  )
  const [launching, setLaunching] = useState(false)

  const detectExtension = useCallback(() => {
    if (typeof document === 'undefined') return
    const version = document.documentElement.getAttribute('data-cv-radar-extension')
    setExtensionStatus(version ? 'installed' : 'missing')
  }, [])

  const launch = useCallback(() => {
    if (typeof window === 'undefined') return
    setLaunching(true)
    window.postMessage(
      {
        source: 'cv-radar',
        type: 'AUTO_APPLY_REQUEST',
        payload: { jobId, jobTitle, company, applyUrl },
      },
      window.location.origin
    )
    toast.success('Auto Apply started - check the new tab')
    setTimeout(() => {
      setLaunching(false)
      setOpen(false)
    }, 800)
  }, [jobId, jobTitle, company, applyUrl])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) detectExtension()
      }}
    >
      <DialogTrigger
        render={
          <Button
            size="sm"
            className="bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-500 text-white hover:opacity-90"
          >
            <Rocket />
            Auto Apply
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Auto Apply</DialogTitle>
          <DialogDescription>
            {jobTitle} · {company}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <MethodCard
            icon={<Puzzle className="h-4 w-4 text-violet-500" />}
            title="Use browser extension"
            description="Opens the application page and fills your details in your own browser. You review and submit."
            badge={
              extensionStatus === 'installed'
                ? { text: 'Detected', tone: 'green' as const }
                : extensionStatus === 'missing'
                  ? { text: 'Not installed', tone: 'amber' as const }
                  : null
            }
            disabled={extensionStatus !== 'installed'}
            action={
              extensionStatus === 'installed' ? (
                <Button size="sm" onClick={launch} disabled={launching}>
                  {launching ? <Loader2 className="animate-spin" /> : <Rocket />}
                  {launching ? 'Starting…' : 'Start Auto Apply'}
                </Button>
              ) : (
                <div className="flex flex-col gap-2 text-xs">
                  <p className="text-muted-foreground">
                    Install the CV Radar extension, then reload this page.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        detectExtension()
                        if (document.documentElement.getAttribute('data-cv-radar-extension')) {
                          toast.success('Extension detected')
                        } else {
                          toast.error('Still not detected - try reloading after install')
                        }
                      }}
                    >
                      <RefreshCw />
                      Re-check
                    </Button>
                    <a
                      href="/help#extension"
                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ring-1 ring-border hover:bg-muted/60"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Install guide
                    </a>
                  </div>
                </div>
              )
            }
          />

          <MethodCard
            icon={<Bot className="h-4 w-4 text-muted-foreground" />}
            title="Server-side automation"
            description="Runs the application on our servers without an extension."
            badge={{ text: 'Coming soon', tone: 'muted' as const }}
            disabled
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function MethodCard({
  icon,
  title,
  description,
  badge,
  disabled,
  action,
}: {
  icon: React.ReactNode
  title: string
  description: string
  badge?: { text: string; tone: 'green' | 'amber' | 'muted' } | null
  disabled?: boolean
  action?: React.ReactNode
}) {
  const badgeClass =
    badge?.tone === 'green'
      ? 'bg-green-500/10 text-green-600 dark:text-green-400 ring-green-500/20'
      : badge?.tone === 'amber'
        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20'
        : 'bg-muted text-muted-foreground ring-border/40'
  return (
    <div
      className={cn(
        'rounded-lg ring-1 ring-border/60 px-4 py-3',
        disabled && !action && 'opacity-60'
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">{title}</p>
            {badge && (
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1',
                  badgeClass
                )}
              >
                {badge.text}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{description}</p>
          {action && <div className="mt-3">{action}</div>}
        </div>
      </div>
    </div>
  )
}
