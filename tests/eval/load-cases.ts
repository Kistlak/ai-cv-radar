import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { CvStructuredSchema, type CvStructured } from '@/lib/ai/schemas'
import type { RawJob } from '@/lib/job-sources/types'
import { LABELS, type Label } from './metrics'

// Loads the synthetic match-eval cases in tests/fixtures/match-eval/ (format in
// that folder's README) and validates them, so a malformed fixture fails loudly
// instead of skewing the numbers.

export const FIXTURES_DIR = path.resolve(import.meta.dirname, '../fixtures/match-eval')

const SearchSchema = z.object({
  queries: z.array(z.string().min(1)).min(1),
  location: z.string().nullable(),
  remoteOnly: z.boolean(),
  maxResults: z.number().int().min(1).max(50),
})

const JobSchema = z.object({
  source: z.enum(['remotive', 'adzuna', 'jsearch']),
  sourceJobId: z.string().min(1),
  title: z.string().min(1),
  company: z.string().min(1),
  location: z.string().nullable(),
  remote: z.boolean(),
  salary: z.string().nullable(),
  postedDaysAgo: z.number().int().min(0).nullable(),
  description: z.string().nullable(),
  applyUrl: z.string().url(),
})

const LabelEntrySchema = z.object({
  label: z.enum(LABELS),
  trap: z.string().optional(),
  why: z.string().min(1),
})

export interface EvalCase {
  name: string
  cvText: string
  profile: CvStructured
  search: z.infer<typeof SearchSchema>
  jobs: RawJob[]
  labels: Record<string, z.infer<typeof LabelEntrySchema>>
}

const DAY_MS = 24 * 60 * 60 * 1000

function readJson(dir: string, file: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
}

export function listCaseNames(): string[] {
  return fs
    .readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
}

// `now` turns postedDaysAgo into a date, so freshness is relative to the run.
export function loadCase(name: string, now: number = Date.now()): EvalCase {
  const dir = path.join(FIXTURES_DIR, name)
  const rawJobs = z.array(JobSchema).parse(readJson(dir, 'jobs.json'))
  const jobs: RawJob[] = rawJobs.map(({ postedDaysAgo, ...job }) => ({
    ...job,
    postedAt: postedDaysAgo === null ? null : new Date(now - postedDaysAgo * DAY_MS),
  }))
  return {
    name,
    cvText: fs.readFileSync(path.join(dir, 'cv.txt'), 'utf8'),
    profile: CvStructuredSchema.parse(readJson(dir, 'profile.json')),
    search: SearchSchema.parse(readJson(dir, 'search.json')),
    jobs,
    labels: z.record(z.string(), LabelEntrySchema).parse(readJson(dir, 'labels.json')),
  }
}

export function labelOf(c: EvalCase, sourceJobId: string): Label {
  const entry = c.labels[sourceJobId]
  if (!entry) throw new Error(`${c.name}: no label for ${sourceJobId}`)
  return entry.label
}
