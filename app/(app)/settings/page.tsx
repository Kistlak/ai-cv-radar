import { ApiKeysForm } from '@/components/api-keys-form'
import { Key, Shield } from 'lucide-react'

export default function SettingsPage() {
  return (
    <div className="space-y-8 animate-in-fade">
      <div>
        <p className="text-sm text-muted-foreground">Settings</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
          API <span className="text-gradient">keys</span>
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Bring your own keys. We encrypt them at rest and never send them back to your
          browser. Each provider has its own signup - click the help link to get yours.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ApiKeysForm />
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 h-fit">
          <div className="glass rounded-2xl p-5">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600/20 via-fuchsia-500/20 to-pink-500/20 text-violet-600 dark:text-violet-300 ring-1 ring-violet-500/20">
                <Shield className="h-4 w-4" />
              </div>
              <h3 className="font-semibold text-sm">How we protect keys</h3>
            </div>
            <ul className="mt-3 space-y-2 text-xs text-muted-foreground leading-relaxed">
              <li>• AES-256-GCM encryption at rest</li>
              <li>• Never sent to the browser after saving</li>
              <li>• Decrypted only server-side for API calls</li>
              <li>• Row-level security enforced at the database</li>
            </ul>
          </div>

          <div className="glass rounded-2xl p-5">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600/20 via-fuchsia-500/20 to-pink-500/20 text-violet-600 dark:text-violet-300 ring-1 ring-violet-500/20">
                <Key className="h-4 w-4" />
              </div>
              <h3 className="font-semibold text-sm">Minimum to search</h3>
            </div>
            <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
              Just an <strong className="text-foreground">Anthropic key </strong> is
              required. We&apos;ll fall back to free Remotive jobs. Add Apify to unlock
              LinkedIn, Indeed, and Glassdoor.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
