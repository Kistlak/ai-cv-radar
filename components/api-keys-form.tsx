'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { CheckCircle2, ExternalLink, Eye, EyeOff, KeyRound } from 'lucide-react'
import { useEffect, useState } from 'react'

type KeyStatus = {
  anthropic_key: boolean
  apify_token: boolean
  adzuna_app_id: boolean
  adzuna_app_key: boolean
  rapidapi_key: boolean
}

type KeyField = {
  id: keyof KeyStatus
  label: string
  placeholder: string
  helpUrl: string
  description: string
  required?: boolean
}

const KEY_FIELDS: KeyField[] = [
  {
    id: 'anthropic_key',
    label: 'Anthropic API Key',
    placeholder: 'sk-ant-...',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    description: 'Required - powers CV parsing and job ranking',
    required: true,
  },
  {
    id: 'apify_token',
    label: 'Apify Token',
    placeholder: 'apify_api_...',
    helpUrl: 'https://console.apify.com/account/integrations',
    description: 'Unlocks LinkedIn, Indeed, and Glassdoor scraping',
  },
  {
    id: 'adzuna_app_id',
    label: 'Adzuna App ID',
    placeholder: 'xxxxxxxx',
    helpUrl: 'https://developer.adzuna.com/overview',
    description: 'Public ID from Adzuna Developer Portal',
  },
  {
    id: 'adzuna_app_key',
    label: 'Adzuna App Key',
    placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    helpUrl: 'https://developer.adzuna.com/overview',
    description: 'Secret key paired with the App ID above',
  },
  {
    id: 'rapidapi_key',
    label: 'RapidAPI Key (JSearch)',
    placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    helpUrl: 'https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch',
    description: 'Free tier: 200 requests/month',
  },
]

export function ApiKeysForm() {
  const [status, setStatus] = useState<KeyStatus | null>(null)
  const [values, setValues] = useState<Partial<Record<keyof KeyStatus, string>>>({})
  const [visible, setVisible] = useState<Partial<Record<keyof KeyStatus, boolean>>>({})
  const [saving, setSaving] = useState<keyof KeyStatus | null>(null)
  const [saved, setSaved] = useState<keyof KeyStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/keys')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {})
  }, [])

  async function saveKey(id: keyof KeyStatus) {
    const value = values[id]
    if (!value?.trim()) return
    setSaving(id)
    setError(null)

    const res = await fetch('/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [id]: value.trim() }),
    })

    if (res.ok) {
      setStatus((prev) => (prev ? { ...prev, [id]: true } : prev))
      setValues((prev) => { const next = { ...prev }; delete next[id]; return next })
      setSaved(id)
      setTimeout(() => setSaved(null), 2500)
    } else {
      setError('Failed to save key. Please try again.')
    }
    setSaving(null)
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {KEY_FIELDS.map((field) => {
        const isSet = status?.[field.id]
        const isVisible = visible[field.id]
        const isSaving = saving === field.id
        const justSaved = saved === field.id
        const value = values[field.id] ?? ''

        return (
          <div
            key={field.id}
            className={cn(
              'glass rounded-2xl p-5 transition-all',
              justSaved && 'ring-1 ring-green-500/40'
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-sm">{field.label}</h3>
                  {field.required && (
                    <span className="inline-flex items-center rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-300 ring-1 ring-violet-500/20 px-2 py-0.5 text-[10px] font-medium">
                      Required
                    </span>
                  )}
                  {isSet ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 ring-1 ring-green-500/20 px-2 py-0.5 text-[10px] font-medium">
                      <CheckCircle2 className="h-3 w-3" />
                      Saved
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-muted/60 text-muted-foreground ring-1 ring-border px-2 py-0.5 text-[10px] font-medium">
                      Not configured
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{field.description}</p>
              </div>
              <a
                href={field.helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 dark:text-violet-300 hover:underline"
              >
                Get key
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            <div className="mt-3 flex gap-2">
              <div className="relative flex-1">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  type={isVisible ? 'text' : 'password'}
                  placeholder={isSet ? '••••••••••••••••' : field.placeholder}
                  value={value}
                  onChange={(e) => setValues((prev) => ({ ...prev, [field.id]: e.target.value }))}
                  className="pl-9 pr-10 h-10 font-mono text-xs"
                />
                {value && (
                  <button
                    type="button"
                    onClick={() => setVisible((p) => ({ ...p, [field.id]: !p[field.id] }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {isVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>
              <Button
                onClick={() => saveKey(field.id)}
                disabled={!value.trim() || isSaving}
                size="sm"
                className={cn(
                  'h-10 px-4 font-medium',
                  justSaved && 'bg-green-500 text-white hover:bg-green-500',
                  !justSaved && value.trim() && 'bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-500 text-white hover:opacity-90'
                )}
              >
                {isSaving ? 'Saving…' : justSaved ? 'Saved ✓' : 'Save'}
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
