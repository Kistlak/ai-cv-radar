'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

// A button that asks for confirmation in a dialog before a destructive action.
// `onConfirm` returns true when it succeeded (the dialog then closes).
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  onConfirm,
  disabled,
}: {
  label: React.ReactNode
  title: string
  description: React.ReactNode
  confirmLabel: string
  onConfirm: () => Promise<boolean>
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    const ok = await onConfirm()
    setBusy(false)
    if (ok) setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <DialogTrigger
        render={
          <Button variant="destructive" size="sm" disabled={disabled}>
            {label}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={busy} />}>Cancel</DialogClose>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
