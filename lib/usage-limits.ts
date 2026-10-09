import { NextResponse } from 'next/server'
import { and, count, eq, gt, sql } from 'drizzle-orm'
import { db } from '@/db'
import { searches, usageCounters } from '@/db/schema'
import type { ResolvedKeys } from '@/lib/keys'
import type { AiProvider } from '@/lib/ai/provider'

// Daily quotas apply only when an operator-paid FALLBACK_* key would pay for
// the call. The concurrent-search limit applies to everyone. 0 disables a limit.

export type QuotaAction = 'search' | 'ai_generation' | 'cv_upload'

export interface QuotaConfig {
  searchesPerDay: number
  aiGenerationsPerDay: number
  cvUploadsPerDay: number
  maxConcurrentSearches: number
}

const DEFAULTS: QuotaConfig = {
  searchesPerDay: 5,
  aiGenerationsPerDay: 30,
  cvUploadsPerDay: 5,
  maxConcurrentSearches: 1,
}

// Searches still 'running' after this long are treated as stranded and don't
// count toward the concurrency limit.
const RUNNING_SEARCH_WINDOW_MS = 10 * 60 * 1000

const APIFY_SOURCES = new Set(['linkedin', 'indeed', 'glassdoor'])

const ACTION_LABELS: Record<QuotaAction, string> = {
  search: 'searches',
  ai_generation: 'AI generations',
  cv_upload: 'CV uploads',
}

function readLimit(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : fallback
}

export function getQuotaConfig(env: Record<string, string | undefined> = process.env): QuotaConfig {
  return {
    searchesPerDay: readLimit(env.QUOTA_SEARCHES_PER_DAY, DEFAULTS.searchesPerDay),
    aiGenerationsPerDay: readLimit(env.QUOTA_AI_GENERATIONS_PER_DAY, DEFAULTS.aiGenerationsPerDay),
    cvUploadsPerDay: readLimit(env.QUOTA_CV_UPLOADS_PER_DAY, DEFAULTS.cvUploadsPerDay),
    maxConcurrentSearches: readLimit(env.MAX_CONCURRENT_SEARCHES, DEFAULTS.maxConcurrentSearches),
  }
}

function limitFor(action: QuotaAction, config: QuotaConfig): number {
  switch (action) {
    case 'search':
      return config.searchesPerDay
    case 'ai_generation':
      return config.aiGenerationsPerDay
    case 'cv_upload':
      return config.cvUploadsPerDay
  }
}

export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export function secondsUntilUtcMidnight(now: Date = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000))
}

// True when the key for the provider that was actually resolved came from FALLBACK_*.
export function isAiFallback(
  usingFallback: ResolvedKeys['usingFallback'],
  provider: AiProvider
): boolean {
  return provider === 'anthropic' ? usingFallback.anthropicKey : usingFallback.geminiKey
}

// A search is operator-paid if its AI calls are, or if it will run Apify on the fallback token.
export function searchUsesFallback(
  usingFallback: ResolvedKeys['usingFallback'],
  provider: AiProvider,
  sources: string[]
): boolean {
  if (isAiFallback(usingFallback, provider)) return true
  return usingFallback.apifyToken && sources.some((s) => APIFY_SOURCES.has(s))
}

export type QuotaResult =
  | { ok: true }
  | { ok: false; action: QuotaAction; limit: number; retryAfterSeconds: number }

// Atomically reserves one unit of today's quota. Never refunded: the paid call
// may already have been billed even if it later fails.
export async function consumeQuota(userId: string, action: QuotaAction): Promise<QuotaResult> {
  const limit = limitFor(action, getQuotaConfig())
  if (limit === 0) return { ok: true }

  const rows = await db
    .insert(usageCounters)
    .values({ userId, action, day: utcDay(), count: 1 })
    .onConflictDoUpdate({
      target: [usageCounters.userId, usageCounters.action, usageCounters.day],
      set: { count: sql`${usageCounters.count} + 1` },
      setWhere: sql`${usageCounters.count} < ${limit}`,
    })
    .returning({ count: usageCounters.count })

  if (rows.length > 0) return { ok: true }
  return { ok: false, action, limit, retryAfterSeconds: secondsUntilUtcMidnight() }
}

export async function hasTooManyRunningSearches(userId: string): Promise<boolean> {
  const max = getQuotaConfig().maxConcurrentSearches
  if (max === 0) return false

  const [row] = await db
    .select({ n: count() })
    .from(searches)
    .where(
      and(
        eq(searches.userId, userId),
        eq(searches.status, 'running'),
        gt(searches.createdAt, new Date(Date.now() - RUNNING_SEARCH_WINDOW_MS))
      )
    )
  return (row?.n ?? 0) >= max
}

export function quotaExceededResponse(result: Extract<QuotaResult, { ok: false }>): NextResponse {
  return NextResponse.json(
    {
      error: `Daily limit reached for shared keys (${result.limit} ${ACTION_LABELS[result.action]}/day). Add your own API key in Settings to keep going, or try again tomorrow.`,
    },
    { status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } }
  )
}

export function tooManyRunningSearchesResponse(): NextResponse {
  return NextResponse.json(
    { error: 'You already have a search running. Wait for it to finish or cancel it.' },
    { status: 429, headers: { 'Retry-After': '30' } }
  )
}
