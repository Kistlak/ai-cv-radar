import { db } from '@/db'
import { jobResults, searches, cvs } from '@/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { getDecryptedKeys } from '@/app/api/keys/route'

export interface JobAIContext {
  job: typeof jobResults.$inferSelect
  cvText: string
  anthropicKey: string
}

export async function loadJobAIContext(
  jobId: string,
  userId: string
): Promise<{ ok: true; ctx: JobAIContext } | { ok: false; error: string; status: number }> {
  const [row] = await db
    .select({ job: jobResults, search: searches })
    .from(jobResults)
    .innerJoin(searches, eq(jobResults.searchId, searches.id))
    .where(and(eq(jobResults.id, jobId), eq(searches.userId, userId)))
    .limit(1)

  if (!row) return { ok: false, error: 'Job not found', status: 404 }

  const [cv] = await db
    .select({ rawText: cvs.rawText })
    .from(cvs)
    .where(eq(cvs.userId, userId))
    .orderBy(desc(cvs.createdAt))
    .limit(1)
  if (!cv) return { ok: false, error: 'No CV on file', status: 400 }

  const keys = await getDecryptedKeys(userId)
  if (!keys?.anthropicKey) return { ok: false, error: 'Anthropic key required', status: 400 }

  return {
    ok: true,
    ctx: { job: row.job, cvText: cv.rawText, anthropicKey: keys.anthropicKey },
  }
}

export function jobDescriptionForPrompt(job: typeof jobResults.$inferSelect): string {
  const desc = (job.description ?? '').replace(/<[^>]+>/g, '').slice(0, 4000)
  return [
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    job.location ? `Location: ${job.location}` : null,
    job.remote ? `Remote: yes` : null,
    job.salary ? `Salary: ${job.salary}` : null,
    '',
    'Description:',
    desc || '(no description provided)',
  ]
    .filter((x) => x !== null)
    .join('\n')
}
