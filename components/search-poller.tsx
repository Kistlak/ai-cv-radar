'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

interface SearchPollerProps {
  searchId: string
}

export default function SearchPoller({ searchId }: SearchPollerProps) {
  const router = useRouter()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/search?id=${searchId}`)
        if (!res.ok) return
        const data = await res.json()
        if (data.search?.status !== 'running') {
          if (intervalRef.current) clearInterval(intervalRef.current)
          router.refresh()
        }
      } catch {
        // network error — keep polling
      }
    }, 3000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [searchId, router])

  return null
}
