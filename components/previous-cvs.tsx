'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { History } from 'lucide-react'
import { ConfirmButton } from '@/components/confirm-button'

export interface PreviousCv {
  id: string
  createdAt: string
  searchCount: number
}

// Older CVs the user can delete. The current (active) CV isn't listed.
export function PreviousCvs({ cvs }: { cvs: PreviousCv[] }) {
  const router = useRouter()
  if (cvs.length === 0) return null

  async function remove(cv: PreviousCv): Promise<boolean> {
    const res = await fetch(`/api/cv/${cv.id}`, { method: 'DELETE' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(body.error ?? 'Could not delete the CV')
      return false
    }
    toast.success('CV deleted')
    router.refresh()
    return true
  }

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600/20 via-fuchsia-500/20 to-pink-500/20 text-violet-600 dark:text-violet-300 ring-1 ring-violet-500/20">
          <History className="h-4 w-4" />
        </div>
        <h3 className="font-semibold text-sm">Previous CVs</h3>
        <span className="text-xs text-muted-foreground">({cvs.length})</span>
      </div>
      <ul className="mt-4 divide-y divide-border/50">
        {cvs.map((cv) => (
          <li key={cv.id} className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                Uploaded {new Date(cv.createdAt).toLocaleDateString()}
              </p>
              <p className="text-xs text-muted-foreground">
                {cv.searchCount === 1 ? '1 search' : `${cv.searchCount} searches`} used this CV
              </p>
            </div>
            <ConfirmButton
              label="Delete"
              title="Delete this CV?"
              description={
                cv.searchCount > 0
                  ? `This also deletes ${cv.searchCount === 1 ? '1 search' : `${cv.searchCount} searches`} and their results. This can't be undone.`
                  : "The file is removed for good. This can't be undone."
              }
              confirmLabel="Delete CV"
              onConfirm={() => remove(cv)}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
