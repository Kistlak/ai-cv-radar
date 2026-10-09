import { z } from 'zod'

// Schemas for AI output we store. Lenient in the parseScores style: optional
// text that's missing or null is normalised, list items that aren't strings are
// dropped, but the fields the app depends on must be there with the right type.

// Optional text: null/undefined become undefined.
const optStr = z
  .string()
  .nullish()
  .transform((v) => v ?? undefined)
// Text inside list items: null/undefined become ''.
const itemStr = z
  .string()
  .nullish()
  .transform((v) => v ?? '')
// Nullable text (the CV-parse shape uses null for "not found").
const nullStr = z
  .string()
  .nullish()
  .transform((v) => v ?? null)
// A list of strings: missing becomes [], non-string items are dropped.
const strList = z
  .array(z.unknown())
  .nullish()
  .transform((a) => (a ?? []).filter((x): x is string => typeof x === 'string'))
// A list of objects: missing becomes [], items that aren't objects are dropped.
function objList<T extends z.ZodTypeAny>(item: T) {
  return z
    .array(z.unknown())
    .nullish()
    .transform((a) => (a ?? []).flatMap((x) => {
      const r = item.safeParse(x)
      return r.success ? [r.data as z.output<T>] : []
    }))
}

// The structured CV saved on upload (cvs.structured). A missing name becomes ''
// rather than failing the upload: the rest of the parse is still useful, and
// the name is shown as '-' on the CV page.
export const CvStructuredSchema = z.object({
  name: z
    .string()
    .nullish()
    .transform((v) => v?.trim() ?? ''),
  email: nullStr,
  location: nullStr,
  summary: nullStr,
  skills: strList,
  experience: objList(
    z.object({ role: itemStr, company: itemStr, period: nullStr, description: nullStr })
  ),
  education: objList(z.object({ degree: itemStr, institution: itemStr, year: nullStr })),
})
export type CvStructured = z.output<typeof CvStructuredSchema>

// Tailored and general CVs (job_results.tailored_cv, cvs.general_cv); matches
// the CvJson type in lib/cv-docx.ts.
export const CvJsonSchema = z.object({
  name: z.string(),
  title: z.string(),
  summary: z.string(),
  contact: z.object({
    email: optStr,
    phone: optStr,
    location: optStr,
    linkedin: optStr,
    website: optStr,
  }),
  experience: objList(
    z.object({
      company: itemStr,
      title: itemStr,
      location: optStr,
      startDate: optStr,
      endDate: optStr,
      bullets: strList,
    })
  ),
  education: objList(z.object({ institution: itemStr, degree: itemStr, year: optStr })),
  skills: strList,
  // Optional section: stays absent when the CV has none (rather than []).
  certifications: z
    .array(z.unknown())
    .nullish()
    .transform((a) => a?.filter((x): x is string => typeof x === 'string') ?? undefined),
})

// The job deep-dive (job_results.deep_dive).
export const DeepDiveSchema = z.object({
  fitSummary: z.string(),
  strengths: strList,
  gaps: strList,
  emphasis: strList,
})
export type DeepDive = z.output<typeof DeepDiveSchema>
