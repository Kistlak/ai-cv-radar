import fs from 'node:fs'
import path from 'node:path'
import { describe, it, vi } from 'vitest'
import { createAiClient, type AiProvider } from '@/lib/ai/provider'
import { logger } from '@/lib/logger'
import { rankJobs } from '@/lib/match-pipeline'
import { labelOf, listCaseNames, loadCase } from './load-cases'
import {
  countLabels,
  isUnscored,
  meanScoreByLabel,
  MAX_UNSCORED_SHARE,
  ndcgAt,
  type LabelCounts,
} from './metrics'

// Match-quality eval: runs every synthetic case in tests/fixtures/match-eval/
// through the same ranking code as a real search and reports how good the top
// 10 is. Calls a real AI provider, so it is never part of `npm test` or CI.
//
//   npm run eval:matching
//
// Env (.env.local):
//   EVAL_AI_PROVIDER    gemini (default) | anthropic
//   EVAL_GEMINI_KEY / EVAL_ANTHROPIC_KEY
//   EVAL_CASE           run one case only (folder name)
//   EVAL_CASES          run several cases, comma-separated (e.g. to split a run
//                       across days on the Gemini free tier: 4 cases ≈ 16 requests)
//   EVAL_LABEL          tag for the results file, e.g. "baseline"
//   EVAL_COMBINE        no AI calls: merge every results file tagged with this
//                       label (latest result per case) into one combined report
//   EVAL_CASE_DELAY_MS  pause between cases (default 65000 on Gemini, so each case's
//                       requests start in a fresh minute of the free tier's per-minute limit; 0 on Anthropic)
// Model overrides (GEMINI_FAST_MODEL etc.) apply as in the app.
// Results: eval-results/<timestamp>-<label>.json and .txt (git-ignored).

const TOP_K = 10
const RESULTS_DIR = path.resolve(import.meta.dirname, '../../eval-results')

const provider: AiProvider = process.env.EVAL_AI_PROVIDER === 'anthropic' ? 'anthropic' : 'gemini'
const apiKey =
  provider === 'anthropic' ? process.env.EVAL_ANTHROPIC_KEY : process.env.EVAL_GEMINI_KEY
const model =
  provider === 'anthropic'
    ? process.env.ANTHROPIC_FAST_MODEL || 'claude-haiku-4-5-20251001 (default)'
    : process.env.GEMINI_FAST_MODEL || 'gemini-3.8-flash (default)'
const caseDelayMs = Number(
  process.env.EVAL_CASE_DELAY_MS ?? (provider === 'gemini' ? 65_000 : 0)
)
const runLabel = (process.env.EVAL_LABEL || 'run').replace(/[^\w.-]+/g, '-')
const combineLabel = process.env.EVAL_COMBINE?.replace(/[^\w.-]+/g, '-')

interface CaseReport {
  case: string
  pool: number
  top: LabelCounts
  ndcg: number
  goodInPool: number
  goodTotal: number
  unscoredPool: number
  unscoredTop: number
  meanScore: ReturnType<typeof meanScoreByLabel>
  invalid: boolean
}

interface RunFile {
  provider: string
  model: string
  label: string
  reports: CaseReport[]
  details: Array<{ case: string }>
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function selectedCases(): string[] {
  if (process.env.EVAL_CASES) {
    return process.env.EVAL_CASES.split(',').map((s) => s.trim()).filter(Boolean)
  }
  return process.env.EVAL_CASE ? [process.env.EVAL_CASE] : listCaseNames()
}

function summarize(reports: CaseReport[]) {
  const n = reports.length
  const avg = (f: (r: CaseReport) => number) =>
    Number((reports.reduce((s, r) => s + f(r), 0) / n).toFixed(2))
  return {
    cases: n,
    good: avg((r) => r.top.good),
    ok: avg((r) => r.top.ok),
    bad: avg((r) => r.top.bad),
    ineligible: avg((r) => r.top.ineligible),
    stale: avg((r) => r.top.stale),
    ndcg: avg((r) => r.ndcg),
    goodInPool: avg((r) => r.goodInPool),
    unscoredPool: avg((r) => r.unscoredPool),
    invalidCases: reports.filter((r) => r.invalid).map((r) => r.case),
  }
}

// Writes <timestamp>-<label>.json and a readable .txt (some environments hide
// test console output).
function writeResults(
  label: string,
  meta: { provider: string; model: string; batchFailures?: Array<{ case: string; error: string }> },
  reports: CaseReport[],
  details: unknown[]
): string {
  const summary = summarize(reports)
  fs.mkdirSync(RESULTS_DIR, { recursive: true })
  const base = path.join(RESULTS_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-${label}`)
  fs.writeFileSync(
    `${base}.json`,
    JSON.stringify({ ...meta, label, summary, reports, details }, null, 2)
  )
  const lines = [
    `provider=${meta.provider} model=${meta.model} label=${label}`,
    'case            good  ok  bad  inelig  stale  nDCG   goodInPool  unscored  meanGood/meanBad',
    ...reports.map((r) =>
      [
        r.case.padEnd(15),
        String(r.top.good).padStart(4),
        String(r.top.ok).padStart(3),
        String(r.top.bad).padStart(4),
        String(r.top.ineligible).padStart(7),
        String(r.top.stale).padStart(6),
        r.ndcg.toFixed(3).padStart(6),
        `${r.goodInPool}/${r.goodTotal}`.padStart(11),
        `${r.unscoredPool}/${r.pool}`.padStart(9),
        `  ${r.meanScore.good ?? '-'}/${r.meanScore.bad ?? '-'}`,
        r.invalid ? '  INVALID' : '',
      ].join(' ')
    ),
    `average: ${JSON.stringify(summary)}`,
  ]
  for (const f of meta.batchFailures ?? []) lines.push(`batch failed (${f.case}): ${f.error}`)
  if (summary.invalidCases.length > 0) {
    lines.push(
      `WARNING: ${summary.invalidCases.length} case(s) had more than ${MAX_UNSCORED_SHARE * 100}% unscored jobs; their numbers measure scoring failures, not ranking.`
    )
  }
  fs.writeFileSync(`${base}.txt`, lines.join('\n') + '\n')
  console.log(lines.join('\n'))
  console.log(`[eval] results: ${base}.json / .txt`)
  return base
}

if (!combineLabel && !apiKey) {
  console.warn(
    `[eval] skipped: set ${provider === 'anthropic' ? 'EVAL_ANTHROPIC_KEY' : 'EVAL_GEMINI_KEY'} in .env.local (provider=${provider}).`
  )
}

describe.skipIf(!!combineLabel || !apiKey)('match quality', () => {
  it('ranks the synthetic cases', { timeout: 30 * 60 * 1000 }, async () => {
    // The app logs failed scoring batches (score_jobs.batch_failed); keep them
    // in the results so a failed case shows why (test console output is hidden).
    const batchFailures: Array<{ case: string; error: string }> = []
    let currentCase = ''
    const warn = vi.spyOn(logger, 'warn').mockImplementation((entry) => {
      if (entry.event === 'score_jobs.batch_failed') {
        const err = (entry as { err?: unknown }).err
        const message = String(err instanceof Error ? err.message : err)
        // Keep the part that says which limit was hit (per minute or per day).
        const quota = message.match(/quotaId"?:\s*"?([\w-]+)/)?.[1]
        batchFailures.push({ case: currentCase, error: quota ? `quota: ${quota}` : message.slice(0, 300) })
      }
    })

    const ai = createAiClient(provider, apiKey!)
    const names = selectedCases()
    const reports: CaseReport[] = []
    const details: unknown[] = []

    for (const [i, name] of names.entries()) {
      if (i > 0 && caseDelayMs > 0) await sleep(caseDelayMs)
      currentCase = name
      const c = loadCase(name)
      let pool = 0
      const { scored, top } = await rankJobs(c.jobs, {
        queries: c.search.queries,
        cvText: c.cvText,
        cvProfile: c.profile,
        ai,
        maxResults: c.search.maxResults,
        onPool: (_fetched, size) => {
          pool = size
        },
      })

      const allLabels = c.jobs.map((j) => labelOf(c, j.sourceJobId))
      const topK = top.slice(0, TOP_K)
      const topLabels = topK.map((j) => labelOf(c, j.sourceJobId))
      const unscoredPool = scored.filter(isUnscored).length
      reports.push({
        case: name,
        pool,
        top: countLabels(topLabels),
        ndcg: Number(ndcgAt(TOP_K, topLabels, allLabels).toFixed(3)),
        goodInPool: scored.filter((j) => labelOf(c, j.sourceJobId) === 'good').length,
        goodTotal: allLabels.filter((l) => l === 'good').length,
        unscoredPool,
        unscoredTop: topK.filter(isUnscored).length,
        meanScore: meanScoreByLabel(
          scored.map((j) => ({ label: labelOf(c, j.sourceJobId), matchScore: j.matchScore }))
        ),
        invalid: pool > 0 && unscoredPool / pool > MAX_UNSCORED_SHARE,
      })
      details.push({
        case: name,
        top: topK.map((j) => ({
          id: j.sourceJobId,
          title: j.title,
          label: labelOf(c, j.sourceJobId),
          score: j.matchScore,
          reason: j.matchReason,
        })),
        scored: scored.map((j) => ({
          id: j.sourceJobId,
          label: labelOf(c, j.sourceJobId),
          score: j.matchScore,
          reason: j.matchReason,
        })),
      })
      console.log(`[eval] ${name}: done (${i + 1}/${names.length})`)
    }

    warn.mockRestore()
    writeResults(runLabel, { provider, model, batchFailures }, reports, details)
  })
})

describe.skipIf(!combineLabel)('match quality (combine)', () => {
  it('merges the runs tagged with EVAL_COMBINE', () => {
    // Every non-combined results file for the label, oldest first, so the
    // latest result for a case wins.
    const suffix = `-${combineLabel}.json`
    const files = fs.existsSync(RESULTS_DIR)
      ? fs.readdirSync(RESULTS_DIR).filter((f) => f.endsWith(suffix)).sort()
      : []
    if (files.length === 0) throw new Error(`no results files tagged "${combineLabel}"`)

    const reports = new Map<string, CaseReport>()
    const details = new Map<string, unknown>()
    const models = new Set<string>()
    for (const file of files) {
      const run = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, file), 'utf8')) as RunFile
      models.add(`${run.provider}/${run.model}`)
      for (const r of run.reports) reports.set(r.case, r)
      for (const d of run.details) details.set(d.case, d)
    }
    // Mixing providers or models would make the average meaningless.
    if (models.size > 1) throw new Error(`runs use different models: ${[...models].join(', ')}`)
    const [meta] = [...models].map((m) => {
      const [p, ...rest] = m.split('/')
      return { provider: p, model: rest.join('/') }
    })

    const missing = listCaseNames().filter((c) => !reports.has(c))
    if (missing.length > 0) console.warn(`[eval] combine: no result yet for ${missing.join(', ')}`)

    const ordered = [...reports.keys()].sort()
    writeResults(
      `${combineLabel}-combined`,
      meta,
      ordered.map((c) => reports.get(c)!),
      ordered.map((c) => details.get(c))
    )
  })
})
