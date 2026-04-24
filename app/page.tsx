import { ThemeToggle } from '@/components/theme-toggle'
import { ArrowRight, Layers, Radar, Shield, Sparkles, Target, Zap } from 'lucide-react'
import Link from 'next/link'

const FEATURES = [
  {
    icon: Sparkles,
    title: 'AI-Ranked Matches',
    desc: 'Claude scores each job 0-100 against your CV and explains why it fits.',
  },
  {
    icon: Layers,
    title: '6 Sources, One Search',
    desc: 'LinkedIn, Indeed, Glassdoor, Adzuna, JSearch, and Remotive - deduplicated.',
  },
  {
    icon: Shield,
    title: 'Bring Your Own Keys',
    desc: 'Your API keys stay encrypted. We never pay for - or see - your usage.',
  },
  {
    icon: Target,
    title: 'One-Click Apply',
    desc: 'Direct links to each posting. No copy-paste, no hunting.',
  },
]

export default function LandingPage() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-gradient-mesh" />

      <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 via-fuchsia-500 to-pink-500 shadow-lg shadow-violet-500/30">
            <Radar className="h-5 w-5 text-white" />
          </div>
          <span className="font-semibold tracking-tight text-lg">AI CV Radar</span>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link
            href="/login"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign in
          </Link>
        </div>
      </header>

      <section className="mx-auto flex max-w-4xl flex-1 flex-col items-center justify-center px-4 py-16 text-center sm:px-6 lg:py-24">
        <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur-sm">
          <Zap className="h-3 w-3 text-violet-500" />
          Powered by Kisalka · Open source friendly
        </div>

        <h1 className="mt-8 text-4xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
          Find jobs that{' '}
          <span className="text-gradient">actually match</span>
          <br />
          your CV.
        </h1>

        <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
          Upload your CV once. Enter a search. Get a ranked list of positions from six
          major job platforms scored and explained by AI for your exact fit.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/login"
            className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 transition-all hover:shadow-xl hover:shadow-violet-500/40 hover:scale-[1.02]"
          >
            Get Started - It&apos;s Free
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <a
            href="#features"
            className="inline-flex items-center rounded-xl border border-border bg-background/50 px-6 py-3 text-sm font-semibold backdrop-blur-sm hover:bg-accent transition-colors"
          >
            Learn More
          </a>
        </div>

        <div className="mt-16 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs text-muted-foreground">
          <span>LinkedIn</span>
          <span className="h-1 w-1 rounded-full bg-border" />
          <span>Indeed</span>
          <span className="h-1 w-1 rounded-full bg-border" />
          <span>Glassdoor</span>
          <span className="h-1 w-1 rounded-full bg-border" />
          <span>Adzuna</span>
          <span className="h-1 w-1 rounded-full bg-border" />
          <span>JSearch</span>
          <span className="h-1 w-1 rounded-full bg-border" />
          <span>Remotive</span>
        </div>
      </section>

      <section id="features" className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => {
            const Icon = f.icon
            return (
              <div
                key={f.title}
                className="group glass rounded-2xl p-6 transition-all hover:scale-[1.02] hover:shadow-xl"
              >
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600/20 via-fuchsia-500/20 to-pink-500/20 text-violet-600 dark:text-violet-300 ring-1 ring-violet-500/20">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            )
          })}
        </div>
      </section>

      <footer className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8 text-center text-xs text-muted-foreground">
        Built with Next.js, Supabase, and Claude API · Your data stays yours
      </footer>
    </main>
  )
}
