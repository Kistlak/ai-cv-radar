import { getDecryptedKeys } from '@/app/api/keys/route'
import { db } from '@/db'
import { cvs } from '@/db/schema'
import { createClient } from '@/lib/supabase/server'
import { createAiClient, resolveProvider } from '@/lib/ai/provider'
import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { extractText, getDocumentProxy } from 'unpdf'

export async function POST(req: NextRequest) {
    // 1. Check the user is logged in
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // 2. Get the uploaded file from the form
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file || file.type !== 'application/pdf')
        return NextResponse.json({ error: 'A PDF file is required' }, { status: 400 })

    // 3. Fetch keys and resolve the active AI provider (Anthropic or Gemini)
    const keys = await getDecryptedKeys(user.id)
    const resolved = resolveProvider(keys.preferredAiProvider, keys)
    if (!resolved)
        return NextResponse.json({ error: 'Add an Anthropic or Gemini API key in Settings.' }, { status: 400 })
    const ai = createAiClient(resolved.provider, resolved.apiKey)

    // 4. Convert the file to a Buffer (raw bytes) so we can parse and upload it
    const buffer = Buffer.from(await file.arrayBuffer())

    // 5. Extract plain text from the PDF using unpdf
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const { text } = await extractText(pdf, { mergePages: true })
    const rawText = Array.isArray(text) ? text.join('\n') : text
    if (!rawText.trim())
        return NextResponse.json({ error: 'Could not extract text from PDF' }, { status: 400 })

    // 6. Upload the original PDF to Supabase Storage
    //    Path format: {userId}/{timestamp}.pdf - matches our storage policy
    const filePath = `${user.id}/${Date.now()}.pdf`
    const { error: storageError } = await supabase.storage
        .from('cvs')
        .upload(filePath, buffer, { contentType: 'application/pdf', upsert: true })
    if (storageError)
        return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 })

    // 7. Ask the active AI provider to extract structured data from the raw CV text
    let structured: Record<string, unknown>
    try {
        const text = await ai.complete({
            tier: 'smart',
            maxTokens: 2048,
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
  ${rawText}`,
        })
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error()
        structured = JSON.parse(jsonMatch[0])
    } catch {
        return NextResponse.json({ error: 'AI could not parse the CV structure' }, { status: 500 })
    }

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

    return NextResponse.json({ cv: newCv })
}
