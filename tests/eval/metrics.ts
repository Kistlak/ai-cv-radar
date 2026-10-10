// Match-quality metrics for the eval (tests/eval/matching.eval.ts). Pure, so
// they're unit-tested in tests/unit/eval-metrics.test.ts.

export const LABELS = ['good', 'ok', 'bad', 'ineligible', 'stale'] as const
export type Label = (typeof LABELS)[number]

// nDCG gain per label: only good and ok jobs are worth showing.
export const GAIN: Record<Label, number> = { good: 3, ok: 1, bad: 0, ineligible: 0, stale: 0 }

export type LabelCounts = Record<Label, number>

export function countLabels(labels: Label[]): LabelCounts {
  const counts: LabelCounts = { good: 0, ok: 0, bad: 0, ineligible: 0, stale: 0 }
  for (const label of labels) counts[label]++
  return counts
}

function dcg(gains: number[]): number {
  return gains.reduce((sum, gain, i) => sum + gain / Math.log2(i + 2), 0)
}

// nDCG@k of a ranking against the best possible ranking of all labelled jobs.
// 1 = the k best jobs in the best order; 0 = nothing worth showing in the top k.
export function ndcgAt(k: number, ranked: Label[], all: Label[]): number {
  const ideal = dcg(all.map((l) => GAIN[l]).sort((a, b) => b - a).slice(0, k))
  if (ideal === 0) return 0
  return dcg(ranked.slice(0, k).map((l) => GAIN[l])) / ideal
}

// A job the model never scored gets scoreJobs' fallback: reason 'Score
// unavailable' for a failed batch, or '' when the model skipped its index.
export function isUnscored(job: { matchReason: string }): boolean {
  return job.matchReason === 'Score unavailable' || job.matchReason === ''
}

export function meanScoreByLabel(
  jobs: Array<{ label: Label; matchScore: number }>
): Partial<Record<Label, number>> {
  const out: Partial<Record<Label, number>> = {}
  for (const label of LABELS) {
    const scores = jobs.filter((j) => j.label === label).map((j) => j.matchScore)
    if (scores.length > 0) {
      out[label] = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    }
  }
  return out
}

// More than this share of unscored jobs makes a run measure failures, not ranking.
export const MAX_UNSCORED_SHARE = 0.1
