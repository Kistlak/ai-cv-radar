import { db } from '@/db'
import { jobResults, searches, cvs } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { getDecryptedKeys } from '@/lib/keys'
import { createAiClient, resolveProvider, type AiClient } from '@/lib/ai/provider'
import { isAiFallback } from '@/lib/usage-limits'
import { UNTRUSTED_JOB_RULE, untrusted } from '@/lib/untrusted'
import { getActiveCv } from '@/lib/cv'

export interface JobAIContext {
  job: typeof jobResults.$inferSelect
  cvText: string
  ai: AiClient
  // True when the AI key is an operator-paid FALLBACK_* key (quota applies).
  usingFallback: boolean
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

  // Use the CV the job's search was scored against, so the deep-dive, cover
  // letter and tailored CV match the score shown. Fall back to the current CV
  // if that one is gone (can't happen today: deleting a CV deletes its searches).
  const [pinned] = await db
    .select({ rawText: cvs.rawText })
    .from(cvs)
    .where(and(eq(cvs.id, row.search.cvId), eq(cvs.userId, userId)))
    .limit(1)
  const cv = pinned ?? (await getActiveCv(userId))
  if (!cv) return { ok: false, error: 'No CV on file', status: 400 }

  const keys = await getDecryptedKeys(userId)
  const resolved = resolveProvider(keys.preferredAiProvider, keys)
  if (!resolved) {
    return { ok: false, error: 'Add an Anthropic or Gemini API key in Settings', status: 400 }
  }

  return {
    ok: true,
    ctx: {
      job: row.job,
      cvText: cv.rawText,
      ai: createAiClient(resolved.provider, resolved.apiKey),
      usingFallback: isAiFallback(keys.usingFallback, resolved.provider),
    },
  }
}

// The job block is wrapped as untrusted data (see lib/untrusted.ts); the rule
// line travels with it, so every prompt that embeds the block gets it.
export function jobDescriptionForPrompt(job: typeof jobResults.$inferSelect): string {
  const desc = (job.description ?? '').replace(/<[^>]+>/g, '').slice(0, 4000)
  return [
    `(${UNTRUSTED_JOB_RULE})`,
    '<job_posting>',
    `Title: ${untrusted(job.title)}`,
    `Company: ${untrusted(job.company)}`,
    job.location ? `Location: ${untrusted(job.location)}` : null,
    job.remote ? `Remote: yes` : null,
    job.salary ? `Salary: ${untrusted(job.salary)}` : null,
    '',
    'Description:',
    desc || '(no description provided)',
    '</job_posting>',
  ]
    .filter((x) => x !== null)
    .join('\n')
}
