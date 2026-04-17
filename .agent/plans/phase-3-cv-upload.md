# Phase 3 — CV Upload & Parse

**Status:** NOT STARTED
**Depends on:** Phase 2 complete and verified
**Goal:** PDF upload → pdf-parse text extraction → Claude structured JSON → stored in DB.

## Steps

- [ ] 1. Create Supabase Storage bucket `cvs`
  - Enable RLS: users can only read/write their own files
  - Policy: `(storage.foldername(name))[1] = auth.uid()::text`
  - Max file size: 5MB
  - Allowed MIME: `application/pdf`

- [ ] 2. Write `src/lib/cv-parser.ts`
  - Input: PDF buffer
  - Step 1: Extract raw text with `pdf-parse`
  - Step 2: Send to Claude with system prompt:
    ```
    "Extract structured data from this CV. Return ONLY valid JSON matching this schema:
    { name, email, phone, location, summary, skills: string[],
      experience: [{title, company, startDate, endDate, description}],
      education: [{degree, institution, year}],
      languages: string[] }"
    ```
  - Step 3: Parse JSON response, validate with Zod schema
  - Step 4: On parse failure, retry up to 2 times
  - Returns: `{ rawText: string, structured: CVStructured }`
  - Instantiate `new Anthropic({ apiKey: userKey })` per request (never shared instance)

- [ ] 3. Write `src/app/api/cv/upload/route.ts`
  - Auth check (401 if not authenticated)
  - Accept multipart/form-data with `file` field
  - Validate: size < 5MB, MIME = application/pdf (Zod)
  - Upload to Supabase Storage at path `{user_id}/{timestamp}.pdf`
  - Call `cv-parser.ts` with PDF buffer + user's decrypted Anthropic key
  - Upsert into `cvs` table: set previous `is_active=false`, insert new row with `is_active=true`
  - Return `{ cv_id, structured }`

- [ ] 4. Write `src/app/api/cv/parse/route.ts` (optional re-parse endpoint)
  - Re-parse an existing CV without re-uploading

- [ ] 5. Write `src/components/cv-uploader.tsx`
  - Dropzone (drag-and-drop or click to browse)
  - Accepts PDF only, max 5MB
  - Shows upload + parsing progress states
  - On success: displays parsed CV in readable card layout
  - Fields shown: Name, Email, Skills (badges), Experience (timeline), Education

- [ ] 6. Write `src/app/(app)/cv/page.tsx`
  - Shows current active CV (if exists)
  - Shows `CvUploader` component
  - After upload, refreshes to show new structured CV

## Zod Schema for Structured CV
```typescript
const CVStructuredSchema = z.object({
  name: z.string(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
  summary: z.string().optional(),
  skills: z.array(z.string()),
  experience: z.array(z.object({
    title: z.string(),
    company: z.string(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    description: z.string().optional(),
  })),
  education: z.array(z.object({
    degree: z.string(),
    institution: z.string(),
    year: z.string().optional(),
  })),
  languages: z.array(z.string()),
})
```

## Verify
- Upload a 2-page PDF CV
- Structured JSON populates correctly in DB
- CV page displays parsed data in readable card layout
- Uploading a second CV deactivates the first
- 6MB PDF is rejected with an error message
- Non-PDF file is rejected
