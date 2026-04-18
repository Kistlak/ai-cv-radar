'use client'

import { cn } from '@/lib/utils'
import { Loader2, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

export default function CvUploadForm() {
    const router = useRouter()
    const inputRef = useRef<HTMLInputElement>(null)
    const [dragging, setDragging] = useState(false)
    const [loading, setLoading] = useState(false)

    async function handleFile(file: File) {
        // Only accept PDFs
        if (file.type !== 'application/pdf') {
            toast.error('Please upload a PDF file')
            return
        }

        setLoading(true)
        try {
            const formData = new FormData()
            formData.append('file', file)

            const res = await fetch('/api/cv/upload', { method: 'POST', body: formData })
            const data = await res.json()

            if (!res.ok) {
                toast.error(data.error ?? 'Upload failed')
                return
            }

            toast.success('CV uploaded and parsed!')
            // Refresh the server component so the parsed CV data shows immediately
            router.refresh()
        } catch {
            toast.error('Something went wrong. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    function onDrop(e: React.DragEvent) {
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files[0]
        if (file) handleFile(file)
    }

    return (
        <div
            onClick={() => !loading && inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
                'glass rounded-2xl p-10 text-center cursor-pointer transition-all',
                dragging && 'ring-2 ring-violet-500 bg-violet-500/5',
                loading && 'cursor-not-allowed opacity-70'
            )}
        >
            <input
                ref={inputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
                disabled={loading}
            />

            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600/10 via-fuchsia-500/10
  to-pink-500/10 ring-1 ring-violet-500/20">
                {loading
                    ? <Loader2 className="h-7 w-7 text-violet-500 animate-spin" />
                    : <Upload className="h-7 w-7 text-violet-500" />
                }
            </div>

            <p className="mt-5 font-semibold">
                {loading ? 'Parsing your CV with Claude…' : 'Drop your PDF here, or click to browse'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
                {loading
                    ? 'This usually takes 10–20 seconds'
                    : 'We will extract your skills, experience, and education automatically'}
            </p>
        </div>
    )
}
