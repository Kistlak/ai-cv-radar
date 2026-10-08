import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSources } from '@/lib/job-sources'
import { fetchRemotive } from '@/lib/job-sources/remotive'
import { runActor } from '@/lib/job-sources/apify'
import { completionSignal } from '@/lib/ai/types'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('source fetchers', () => {
  it('pass a signal that follows the search cancel signal', async () => {
    let seen: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      seen = init?.signal ?? undefined
      return new Response(JSON.stringify({ jobs: [] }))
    }))

    const controller = new AbortController()
    await fetchRemotive({ query: 'laravel', signal: controller.signal })
    expect(seen?.aborted).toBe(false)
    controller.abort()
    expect(seen?.aborted).toBe(true)
  })

  it('still time out without a cancel signal', async () => {
    let seen: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      seen = init?.signal ?? undefined
      return new Response(JSON.stringify({ jobs: [] }))
    }))
    await fetchRemotive({ query: 'laravel' })
    expect(seen).toBeInstanceOf(AbortSignal)
  })
})

describe('fetchSources on cancel', () => {
  it('returns [] without logging an error for a cancelled source', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      init?.signal?.throwIfAborted()
      return new Response(JSON.stringify({ jobs: [] }))
    }))

    const jobs = await fetchSources({ query: 'laravel', signal: controller.signal }, {}, ['remotive'])
    expect(jobs).toEqual([])
    expect(errors).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('still logs real source failures', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })))

    expect(await fetchSources({ query: 'laravel' }, {}, ['remotive'])).toEqual([])
    expect(errors).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  })
})

describe('runActor', () => {
  function fakeApify(statuses: string[]) {
    const abort = vi.fn(async () => ({}))
    const waitForFinish = vi.fn(async () => ({ id: 'run-1', status: statuses.shift() ?? 'RUNNING' }))
    const start = vi.fn(async () => ({ id: 'run-1', status: 'READY' }))
    const client = {
      actor: () => ({ start }),
      run: () => ({ waitForFinish, abort }),
    }
    return { client: client as never, start, waitForFinish, abort }
  }

  it('starts the actor with a timeout and waits until it finishes', async () => {
    const { client, start, waitForFinish } = fakeApify(['RUNNING', 'SUCCEEDED'])
    const run = await runActor(client, 'actor', { q: 1 })
    expect(run.status).toBe('SUCCEEDED')
    expect(start).toHaveBeenCalledWith({ q: 1 }, { timeout: 150 })
    expect(waitForFinish).toHaveBeenCalledTimes(2)
  })

  it('aborts the Apify run and throws when the search is cancelled', async () => {
    const controller = new AbortController()
    const { client, abort, waitForFinish } = fakeApify([])
    waitForFinish.mockImplementation(async () => {
      controller.abort()
      return { id: 'run-1', status: 'RUNNING' }
    })

    await expect(runActor(client, 'actor', {}, controller.signal)).rejects.toBeDefined()
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('does not abort a run that already finished', async () => {
    const controller = new AbortController()
    const { client, abort, waitForFinish } = fakeApify([])
    waitForFinish.mockImplementation(async () => {
      controller.abort()
      return { id: 'run-1', status: 'SUCCEEDED' }
    })

    const run = await runActor(client, 'actor', {}, controller.signal)
    expect(run.status).toBe('SUCCEEDED')
    expect(abort).not.toHaveBeenCalled()
  })
})

describe('completionSignal', () => {
  it('is undefined when neither option is set', () => {
    expect(completionSignal({})).toBeUndefined()
  })

  it('returns the caller signal when there is no timeout', () => {
    const controller = new AbortController()
    expect(completionSignal({ signal: controller.signal })).toBe(controller.signal)
  })

  it('combines the caller signal with the timeout', () => {
    const controller = new AbortController()
    const combined = completionSignal({ signal: controller.signal, timeoutMs: 60_000 })!
    expect(combined.aborted).toBe(false)
    controller.abort()
    expect(combined.aborted).toBe(true)
  })
})
