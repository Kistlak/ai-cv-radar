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
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  FileText,
  FileUser,
  ImageIcon,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

interface CvJsonPreview {
  name: string
  title: string
  summary: string
  skills: string[]
  experience: Array<{ company: string; title: string; bullets: string[] }>
}

export function CvPolishActions() {
  return (
    <div className="glass rounded-2xl p-5 lg:col-span-3">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600/20 via-fuchsia-500/20 to-pink-500/20 text-violet-600 dark:text-violet-300 ring-1 ring-violet-500/20">
          <Sparkles className="h-4 w-4" />
        </div>
        <h3 className="font-semibold text-sm">Polish for applications</h3>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Generate a clean, ATS-friendly CV and a reusable cover letter from your uploaded CV. Download as .docx and edit in Word for each application.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <GeneralCvButton />
        <GeneralCoverLetterButton />
      </div>
    </div>
  )
}

function GeneralCvButton() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cv, setCv] = useState<CvJsonPreview | null>(null)
  const [withPhoto, setWithPhoto] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const load = useCallback(
    async (force = false) => {
      if (!force && (cv || loading)) return
      if (force) setRegenerating(true)
      else setLoading(true)
      setError(null)
      try {
        const url = `/api/cv/general-cv${force ? '?regenerate=1' : ''}`
        const res = await fetch(url, { method: 'POST' })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error ?? 'Failed to generate CV')
        setCv(body.generalCv as CvJsonPreview)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
        setRegenerating(false)
      }
    },
    [cv, loading]
  )

  const download = useCallback(async () => {
    setDownloading(true)
    try {
      const res = await fetch(`/api/cv/general-cv/download?photo=${withPhoto ? '1' : '0'}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Download failed')
      }
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const match = disposition.match(/filename="([^"]+)"/)
      const filename = match?.[1] ?? 'cv.docx'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('CV downloaded - open in Word to edit')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }, [withPhoto])

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
            Generate polished CV
          </Button>
        }
      />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>ATS-friendly CV</DialogTitle>
          <DialogDescription>
            Reusable version polished for similar roles that match your background.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
            Rewriting your CV for ATS…
          </div>
        )}

        {error && !loading && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 ring-1 ring-destructive/20 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">Couldn&apos;t generate CV</p>
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
                  <p className="mt-1 text-foreground/80">{cv.skills.slice(0, 18).join(' · ')}</p>
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
                <span className="text-muted-foreground"> - enable for UAE/EU/DE/FR. Skip for UK/US/CA/AU.</span>
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

function GeneralCoverLetterButton() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [letter, setLetter] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const load = useCallback(
    async (force = false) => {
      if (!force && (letter || loading)) return
      if (force) setRegenerating(true)
      else setLoading(true)
      setError(null)
      try {
        const url = `/api/cv/general-cover-letter${force ? '?regenerate=1' : ''}`
        const res = await fetch(url, { method: 'POST' })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error ?? 'Failed to generate cover letter')
        setLetter(body.coverLetter as string)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
        setRegenerating(false)
      }
    },
    [letter, loading]
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

  const download = useCallback(async () => {
    setDownloading(true)
    try {
      const res = await fetch(`/api/cv/general-cover-letter/download`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Download failed')
      }
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const match = disposition.match(/filename="([^"]+)"/)
      const filename = match?.[1] ?? 'cover_letter.docx'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('Cover letter downloaded - replace [Company Name] and [Role Title] in Word')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }, [])

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
            Generate cover letter
          </Button>
        }
      />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Reusable cover letter</DialogTitle>
          <DialogDescription>
            Customize the [Company Name] and [Role Title] placeholders for each application.
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
            <div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/40 ring-1 ring-border/40 px-4 py-3 text-sm leading-relaxed text-foreground">
              {letter}
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => load(true)}
                disabled={regenerating}
              >
                {regenerating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {regenerating ? 'Regenerating…' : 'Regenerate'}
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={copy} size="sm">
                  {copied ? <Check /> : <Copy />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                <Button onClick={download} size="sm" disabled={downloading}>
                  {downloading ? <Loader2 className="animate-spin" /> : <Download />}
                  {downloading ? 'Preparing…' : 'Download .docx'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
