import { getDecryptedKeys } from '@/lib/keys'
import { db } from '@/db'
import { cvs } from '@/db/schema'
import { createAiClient, resolveProvider } from '@/lib/ai/provider'
import {
    CV_TOO_LARGE_MESSAGE,
    MAX_CV_BYTES,
    MULTIPART_OVERHEAD_BYTES,
    isPdfBytes,
    textForParsing,
} from '@/lib/cv-upload'
import { logger } from '@/lib/logger'
import { extractJson } from '@/lib/ai/parse-json'
import { CvStructuredSchema, type CvStructured } from '@/lib/ai/schemas'
import { consumeQuota, isAiFallback, quotaExceededResponse } from '@/lib/usage-limits'
import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { extractText, getDocumentProxy } from 'unpdf'
import { requireUser } from '@/lib/auth'
import { pruneUnusedCvs } from '@/lib/cv-retention'

export async function POST(req: NextRequest) {
    // 1. Check the user is logged in
    const auth = await requireUser()
    if (auth.response) return auth.response
    const { user, supabase } = auth

    // 2. Get the uploaded file from the form. Reject an oversized body from its
    //    header before formData() reads it all into memory; file.size below is
    //    the authoritative check (the header can be absent).
    if (Number(req.headers.get('content-length') ?? 0) > MAX_CV_BYTES + MULTIPART_OVERHEAD_BYTES)
        return NextResponse.json({ error: CV_TOO_LARGE_MESSAGE }, { status: 413 })
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file || file.type !== 'application/pdf')
        return NextResponse.json({ error: 'A PDF file is required' }, { status: 400 })
    if (file.size > MAX_CV_BYTES)
        return NextResponse.json({ error: CV_TOO_LARGE_MESSAGE }, { status: 413 })

    // 3. Fetch keys and resolve the active AI provider (Anthropic or Gemini)
    const keys = await getDecryptedKeys(user.id)
    const resolved = resolveProvider(keys.preferredAiProvider, keys)
    if (!resolved)
        return NextResponse.json({ error: 'Add an Anthropic or Gemini API key in Settings.' }, { status: 400 })
    const ai = createAiClient(resolved.provider, resolved.apiKey)

    // 4. Convert the file to a Buffer (raw bytes) so we can parse and upload it
    const buffer = Buffer.from(await file.arrayBuffer())
    // The browser-reported type is only a claim; check the bytes are a PDF.
    if (!isPdfBytes(buffer))
        return NextResponse.json({ error: 'A PDF file is required' }, { status: 400 })

    // 5. Extract plain text from the PDF using unpdf
    let rawText: string
    try {
        const pdf = await getDocumentProxy(new Uint8Array(buffer))
        const { text } = await extractText(pdf, { mergePages: true })
        rawText = Array.isArray(text) ? text.join('\n') : text
    } catch {
        return NextResponse.json({ error: 'Could not read this PDF' }, { status: 400 })
    }
    if (!rawText.trim())
        return NextResponse.json({ error: 'Could not extract text from PDF' }, { status: 400 })

    // Count the upload only once the PDF is readable, and before storing it so
    // an over-limit request doesn't leave an orphaned file behind.
    if (isAiFallback(keys.usingFallback, resolved.provider)) {
        const quota = await consumeQuota(user.id, 'cv_upload')
        if (!quota.ok) return quotaExceededResponse(quota)
    }

    // 6. Ask the active AI provider to extract structured data from the CV text.
    //    Only the parse prompt is capped; the full text is saved below.
    const parse = textForParsing(rawText)
    if (parse.truncated)
        logger.warn({ event: 'cv_upload.text_truncated', userId: user.id, chars: rawText.length })
    let structured: CvStructured
    try {
        const text = await ai.complete({
            tier: 'smart',
            maxTokens: 2048,
            json: true,
            prompt: `Extract structured data from this CV. Return ONLY valid JSON matching this exact shape, no explanation:
  {
    "name": string,
    "email": string | null,
    "location": string | null,
    "summary": string | null,
    "skills": string[],
    "experience": [{ "role": string, "company": string, "period": string | null, "description": string | null }],
    "education": [{ "degree": string, "institution": string, "year": string | null }]
  }

  CV text:
  ${parse.text}`,
        })
        // Validate before storing: a malformed parse would otherwise be saved and
        // break the CV page, downloads and the extension profile later.
        structured = CvStructuredSchema.parse(extractJson(text, 'object'))
    } catch {
        return NextResponse.json({ error: 'AI could not parse the CV structure' }, { status: 500 })
    }

    // 7. Upload the original PDF to Supabase Storage, only now that parsing
    //    worked, so a failed parse doesn't leave an orphaned file.
    //    Path format: {userId}/{timestamp}.pdf - matches our storage policy
    const filePath = `${user.id}/${Date.now()}.pdf`
    const { error: storageError } = await supabase.storage
        .from('cvs')
        .upload(filePath, buffer, { contentType: 'application/pdf', upsert: true })
    if (storageError)
        return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 })

    // 9. Deactivate any previous CVs for this user (only one active at a time)
    await db.update(cvs).set({ isActive: false }).where(eq(cvs.userId, user.id))

    // 10. Save the new CV record to the database
    const [newCv] = await db.insert(cvs).values({
        userId: user.id,
        filePath,
        rawText,
        structured,
        isActive: true,
    }).returning()

    // 11. Remove old CVs that no search uses. Best-effort: never fails the upload.
    try {
        await pruneUnusedCvs(user.id, supabase)
    } catch (err) {
        logger.warn({ event: 'cv_upload.prune_failed', userId: user.id, err })
    }

    return NextResponse.json({ cv: newCv })
}
