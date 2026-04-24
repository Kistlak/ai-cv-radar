import { FileWarning, Puzzle, ShieldCheck, Wrench } from 'lucide-react'

export default function HelpPage() {
  return (
    <div className="space-y-10 animate-in-fade">
      <div>
        <p className="text-sm text-muted-foreground">Help</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
          Getting <span className="text-gradient">started</span>
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Guides for installing the browser extension and using Auto Apply.
        </p>
      </div>

      <section id="extension" className="scroll-mt-24 space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600/20 via-fuchsia-500/20 to-pink-500/20 text-violet-600 dark:text-violet-300 ring-1 ring-violet-500/20">
            <Puzzle className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">Install the Auto Apply extension</h2>
            <p className="text-xs text-muted-foreground">
              Chromium-based browsers (Chrome, Edge, Brave, Arc). Manifest V3.
            </p>
          </div>
        </div>

        <div className="glass rounded-2xl p-6 space-y-5">
          <div>
            <h3 className="text-sm font-semibold">1. Get the extension folder</h3>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              The extension lives in the <code className="rounded bg-muted px-1 py-0.5 text-[11px]">extension/</code>{' '}
              folder of this project. Clone or download the repo so you have that folder on disk.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold">2. Open the extensions page</h3>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Paste <code className="rounded bg-muted px-1 py-0.5 text-[11px]">chrome://extensions</code> into your
              address bar (or <code className="rounded bg-muted px-1 py-0.5 text-[11px]">edge://extensions</code>,{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">brave://extensions</code>).
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold">3. Enable Developer mode</h3>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Toggle <strong className="text-foreground">Developer mode</strong> in the top-right of the page.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold">4. Load unpacked</h3>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Click <strong className="text-foreground">Load unpacked</strong> and select the{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">extension/</code> folder. You should see
              &ldquo;CV Radar - Auto Apply&rdquo; appear in your extension list.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold">5. Reload this tab</h3>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Come back to CV Radar and refresh. Open any job result, click{' '}
              <strong className="text-foreground">Auto Apply</strong>, and the dialog should now show{' '}
              <span className="inline-flex items-center rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400 ring-1 ring-green-500/20">
                Detected
              </span>
              .
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="glass rounded-2xl p-5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-violet-500" />
              <h3 className="text-sm font-semibold">What it does</h3>
            </div>
            <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground leading-relaxed">
              <li>• Opens the application page in a new tab</li>
              <li>• Fills name, contact, links, and known ATS fields</li>
              <li>• Shows a floating badge with Undo / Dismiss</li>
              <li>• Never submits - you review and click submit</li>
            </ul>
          </div>

          <div className="glass rounded-2xl p-5">
            <div className="flex items-center gap-2">
              <FileWarning className="h-4 w-4 text-amber-500" />
              <h3 className="text-sm font-semibold">What it skips</h3>
            </div>
            <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground leading-relaxed">
              <li>• File uploads (CV/cover letter) - pick these yourself</li>
              <li>• Auth-walled sites (LinkedIn, Indeed, company SSO)</li>
              <li>• CAPTCHA, honeypots, custom freeform questions</li>
              <li>• Fields not in your CV (visa, salary, EEO)</li>
            </ul>
          </div>
        </div>

        <div className="glass rounded-2xl p-5">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-violet-500" />
            <h3 className="text-sm font-semibold">Troubleshooting</h3>
          </div>
          <ul className="mt-3 space-y-2 text-xs text-muted-foreground leading-relaxed">
            <li>
              <strong className="text-foreground">Still says &ldquo;Not installed&rdquo;:</strong> hard-reload this
              page (<code className="rounded bg-muted px-1 py-0.5 text-[11px]">Ctrl/Cmd + Shift + R</code>) and click{' '}
              <strong className="text-foreground">Re-check</strong> in the Auto Apply dialog.
            </li>
            <li>
              <strong className="text-foreground">Extension disabled after browser restart:</strong> Chromium may
              warn about unpacked extensions. Re-enable it from{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">chrome://extensions</code>.
            </li>
            <li>
              <strong className="text-foreground">Running on a non-localhost URL:</strong> the extension only
              activates on <code className="rounded bg-muted px-1 py-0.5 text-[11px]">localhost:3000</code>,{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">127.0.0.1:3000</code>, and{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">*.vercel.app</code>. Edit{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">extension/manifest.json</code> to add your
              own origin, then reload the extension.
            </li>
          </ul>
        </div>
      </section>
    </div>
  )
}
