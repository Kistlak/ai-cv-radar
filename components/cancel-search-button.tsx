'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Ban, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function CancelSearchButton({ searchId }: { searchId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function onClick() {
    setLoading(true)
    try {
      const res = await fetch(`/api/search/${searchId}/cancel`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Cancel failed')
      toast.success('Search cancelled')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Cancel failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={loading}>
      {loading ? <Loader2 className="animate-spin" /> : <Ban />}
      {loading ? 'Cancelling…' : 'Cancel search'}
    </Button>
  )
}
