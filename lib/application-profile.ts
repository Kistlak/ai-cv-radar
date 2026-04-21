import { desc, eq, and } from 'drizzle-orm'
import { db } from '@/db'
import { cvs } from '@/db/schema'
import { isCvJson, type CvJson } from '@/lib/cv-docx'

export interface ApplicationProfile {
  firstName: string | null
  lastName: string | null
  fullName: string | null
  email: string | null
  phone: string | null
  location: string | null
  linkedin: string | null
  website: string | null
  title: string | null
  summary: string | null
  skills: string[]
  experience: Array<{
    company: string
    title: string
    location: string | null
    startDate: string | null
    endDate: string | null
    bullets: string[]
  }>
  education: Array<{
    institution: string
    degree: string
    year: string | null
  }>
}

interface StructuredCv {
  name?: unknown
  email?: unknown
  location?: unknown
  summary?: unknown
  skills?: unknown
  experience?: unknown
  education?: unknown
}

function splitName(full: string | null): { first: string | null; last: string | null } {
  if (!full) return { first: null, last: null }
  const parts = full.trim().split(/\s+/)
  if (parts.length === 0) return { first: null, last: null }
  if (parts.length === 1) return { first: parts[0], last: null }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
}

export async function buildApplicationProfile(
  userId: string,
  userEmail: string | null
): Promise<{ ok: true; profile: ApplicationProfile } | { ok: false; error: string; status: number }> {
  const [activeCv] = await db
    .select()
    .from(cvs)
    .where(and(eq(cvs.userId, userId), eq(cvs.isActive, true)))
    .orderBy(desc(cvs.createdAt))
    .limit(1)

  const [cv] = activeCv
    ? [activeCv]
    : await db
        .select()
        .from(cvs)
        .where(eq(cvs.userId, userId))
        .orderBy(desc(cvs.createdAt))
        .limit(1)

  if (!cv) return { ok: false, error: 'Upload a CV first', status: 400 }

  const general: CvJson | null = isCvJson(cv.generalCv) ? cv.generalCv : null
  const structured = (cv.structured ?? {}) as StructuredCv

  const fullName = general?.name ?? str(structured.name)
  const { first, last } = splitName(fullName)

  const email = general?.contact?.email ?? str(structured.email) ?? userEmail
  const phone = general?.contact?.phone ?? null
  const location = general?.contact?.location ?? str(structured.location)
  const linkedin = general?.contact?.linkedin ?? null
  const website = general?.contact?.website ?? null
  const title = general?.title ?? null
  const summary = general?.summary ?? str(structured.summary)

  const skills = general?.skills ?? strArray(structured.skills)

  const experience: ApplicationProfile['experience'] = general
    ? general.experience.map((e) => ({
        company: e.company,
        title: e.title,
        location: e.location ?? null,
        startDate: e.startDate ?? null,
        endDate: e.endDate ?? null,
        bullets: e.bullets ?? [],
      }))
    : Array.isArray(structured.experience)
      ? (structured.experience as Array<Record<string, unknown>>).map((e) => ({
          company: str(e.company) ?? '',
          title: str(e.role) ?? str(e.title) ?? '',
          location: null,
          startDate: null,
          endDate: str(e.period),
          bullets: typeof e.description === 'string' ? [e.description] : [],
        }))
      : []

  const education: ApplicationProfile['education'] = general
    ? general.education.map((e) => ({
        institution: e.institution,
        degree: e.degree,
        year: e.year ?? null,
      }))
    : Array.isArray(structured.education)
      ? (structured.education as Array<Record<string, unknown>>).map((e) => ({
          institution: str(e.institution) ?? '',
          degree: str(e.degree) ?? '',
          year: str(e.year),
        }))
      : []

  return {
    ok: true,
    profile: {
      firstName: first,
      lastName: last,
      fullName,
      email,
      phone,
      location,
      linkedin,
      website,
      title,
      summary,
      skills,
      experience,
      education,
    },
  }
}
