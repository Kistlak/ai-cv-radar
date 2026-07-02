// Structured JSON logger. Emits to stdout (so Vercel's log viewer works) AND
// ships each event to Axiom's HTTP ingest API when AXIOM_TOKEN + AXIOM_DATASET
// are set (needed on Vercel Hobby, where Log Drains require Pro).
//
// Example:
//   logger.info({ event: 'run_search.completed', searchId, jobs: 42, ms: 12000 })
//   logger.error({ event: 'run_search.failed', searchId, err })
//
// Ship is fire-and-forget so log calls stay sync. Call `await logger.flush()`
// at the end of long-running work (e.g. runSearch) so the last events aren't
// dropped when the serverless function terminates.

type LogLevel = 'info' | 'warn' | 'error'

interface BaseFields {
  event: string
  err?: unknown
  [key: string]: unknown
}

const AXIOM_TOKEN = process.env.AXIOM_TOKEN
const AXIOM_DATASET = process.env.AXIOM_DATASET
const AXIOM_URL =
  AXIOM_TOKEN && AXIOM_DATASET
    ? `https://api.axiom.co/v1/datasets/${AXIOM_DATASET}/ingest`
    : null

// Per-ship timeout — Axiom must never wedge the app if it's slow/down.
const SHIP_TIMEOUT_MS = 5000

const pending = new Set<Promise<unknown>>()

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      errorMessage: err.message,
      errorName: err.name,
      errorStack: err.stack,
    }
  }
  return { errorMessage: String(err) }
}

function ship(payload: Record<string, unknown>): void {
  if (!AXIOM_URL || !AXIOM_TOKEN) return
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SHIP_TIMEOUT_MS)
  // Axiom uses `_time` for the event timestamp when present.
  const body = JSON.stringify([{ _time: payload.ts, ...payload }])
  const p = fetch(AXIOM_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${AXIOM_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body,
    signal: controller.signal,
  })
    .catch(() => {
      // Never break the app because logging failed.
    })
    .finally(() => {
      clearTimeout(timeout)
      pending.delete(p)
    })
  pending.add(p)
}

function emit(level: LogLevel, fields: BaseFields): void {
  const { err, ...rest } = fields
  const payload: Record<string, unknown> = {
    level,
    ts: new Date().toISOString(),
    ...rest,
  }
  if (err !== undefined) {
    Object.assign(payload, serializeError(err))
  }
  const line = JSON.stringify(payload)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
  ship(payload)
}

export const logger = {
  info: (fields: BaseFields) => emit('info', fields),
  warn: (fields: BaseFields) => emit('warn', fields),
  error: (fields: BaseFields) => emit('error', fields),
  // Await all in-flight Axiom ships. Call before the serverless function ends.
  // Each ship has its own SHIP_TIMEOUT_MS cap, so flush resolves quickly even
  // if Axiom is unreachable.
  flush: async (): Promise<void> => {
    if (pending.size === 0) return
    await Promise.allSettled(Array.from(pending))
  },
}
