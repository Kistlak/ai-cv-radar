'use client'

import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, CheckCircle2, Mail, Radar } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback` },
    })

    if (error) setError(error.message)
    else setSent(true)
    setLoading(false)
  }

  return (
    <main className="relative flex min-h-screen flex-col bg-gradient-mesh">
      <div className="flex items-center justify-between px-4 py-6 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center text-center mb-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 via-fuchsia-500 to-pink-500 shadow-lg shadow-violet-500/30 glow-primary">
              <Radar className="h-6 w-6 text-white" />
            </div>
            <h1 className="mt-5 text-2xl font-bold tracking-tight sm:text-3xl">
              Welcome back
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in to AI CV Radar with a magic link
            </p>
          </div>

          <div className="glass rounded-2xl p-6 sm:p-8 shadow-xl">
            {sent ? (
              <div className="flex flex-col items-center text-center py-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10 ring-1 ring-green-500/20">
                  <CheckCircle2 className="h-6 w-6 text-green-500" />
                </div>
                <h2 className="mt-4 font-semibold">Check your inbox</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  We sent a magic link to <span className="font-medium text-foreground">{email}</span>.
                  Click the link to sign in. You can close this tab.
                </p>
                <button
                  type="button"
                  onClick={() => { setSent(false); setEmail('') }}
                  className="mt-5 text-xs text-muted-foreground hover:text-foreground underline underline-offset-4"
                >
                  Use a different email
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="email" className="text-sm font-medium">
                    Email address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={loading}
                      className="pl-9 h-11"
                    />
                  </div>
                </div>

                {error && (
                  <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loading || !email}
                  className="w-full h-11 bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-500 text-white font-semibold hover:opacity-90 transition-opacity"
                >
                  {loading ? 'Sending link…' : 'Send Magic Link'}
                </Button>

                <p className="text-center text-xs text-muted-foreground pt-2">
                  By continuing, you agree to the terms of use. We&apos;ll email you a
                  one-time sign-in link - no password needed.
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
