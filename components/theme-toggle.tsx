'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const isDark = mounted && theme === 'dark'

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label="Toggle theme"
      className={cn(
        'relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background/50 backdrop-blur transition-colors hover:bg-accent hover:text-accent-foreground',
        className
      )}
    >
      <Sun className={cn('h-4 w-4 transition-all', isDark ? 'scale-0 rotate-90' : 'scale-100 rotate-0')} />
      <Moon className={cn('absolute h-4 w-4 transition-all', isDark ? 'scale-100 rotate-0' : 'scale-0 -rotate-90')} />
    </button>
  )
}
