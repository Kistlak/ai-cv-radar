import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}))

import { runAgenticSearch, trimUnansweredToolCalls } from '@/lib/agentic-search'

type Block = Record<string, unknown> & { type: string }

const input = {
  cvText: 'Senior Laravel developer',
  userQuery: 'Laravel Developer',
  remoteOnly: false,
  anthropicKey: 'sk-test',
  apifyToken: 'apify-test',
}

const finalize: Block = {
  type: 'tool_use',
  id: 'toolu_final',
  name: 'finalize_jobs',
  input: {
    jobs: [{ source: 'linkedin', sourceJobId: '1', title: 'Laravel Dev', company: 'Acme', applyUrl: 'https://x.test/1' }],
  },
}
const mcpUse = (id: string): Block => ({ type: 'mcp_tool_use', id, name: 'call-actor', server_name: 'apify', input: {} })
const mcpResult = (id: string): Block => ({ type: 'mcp_tool_result', tool_use_id: id, is_error: false, content: [] })

function response(stop_reason: string, content: Block[]) {
  return { stop_reason, content, usage: { input_tokens: 10, output_tokens: 10 } }
}

// Returns the canned responses in order and records each request's messages.
function fakeClient(responses: ReturnType<typeof response>[]) {
  const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = []
  type Params = { messages: Array<{ role: string; content: unknown }> }
  const create = vi.fn<(params: Params, options?: { signal?: AbortSignal }) => Promise<ReturnType<typeof response>>>(async (params) => {
    requests.push({ messages: structuredClone(params.messages) })
    const next = responses.shift()
    if (!next) throw new Error('unexpected request')
    return next
  })
  return { client: { beta: { messages: { create } } } as never, requests, create }
}

describe('runAgenticSearch', () => {
  it('judges results by field and requirements, not by tech stack', async () => {
    const { client, create } = fakeClient([response('tool_use', [mcpUse('a'), mcpResult('a'), finalize])])
    await runAgenticSearch(input, client)
    const { system } = create.mock.calls[0][0] as unknown as { system: string }
    expect(system).toContain('wrong field, missing core requirements')
    expect(system).not.toMatch(/wrong stack/)
  })

  it('returns jobs when the first request finalizes', async () => {
    const { client, create } = fakeClient([response('tool_use', [mcpUse('a'), mcpResult('a'), finalize])])
    const jobs = await runAgenticSearch(input, client)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ title: 'Laravel Dev', source: 'linkedin' })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('continues after pause_turn by re-sending the paused turn, with no new user message', async () => {
    const paused1 = [mcpUse('a'), mcpResult('a')]
    const paused2 = [mcpUse('b'), mcpResult('b')]
    const { client, requests } = fakeClient([
      response('pause_turn', paused1),
      response('pause_turn', paused2),
      response('tool_use', [finalize]),
    ])
    const counts: number[] = []
    const jobs = await runAgenticSearch(
      { ...input, onEvent: (e) => { counts.push(e.count) } },
      client
    )

    expect(jobs).toHaveLength(1)
    expect(requests).toHaveLength(3)
    expect(requests[1].messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(requests[1].messages[1].content).toEqual(paused1)
    expect(requests[2].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'assistant'])
    // MCP calls are summed across requests.
    expect(counts).toEqual([1, 2, 2])
  })

  it('recovers once from max_tokens by asking it to finalize, trimming an unanswered tool call', async () => {
    const { client, requests } = fakeClient([
      response('max_tokens', [mcpUse('a'), mcpResult('a'), mcpUse('b')]),
      response('tool_use', [finalize]),
    ])
    const jobs = await runAgenticSearch(input, client)

    expect(jobs).toHaveLength(1)
    const sent = requests[1].messages
    expect(sent.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(sent[1].content).toEqual([mcpUse('a'), mcpResult('a')])
    expect(String(sent[2].content)).toContain('finalize_jobs')
  })

  it('treats a finalize_jobs call cut off by max_tokens as truncated and recovers', async () => {
    const { client, requests } = fakeClient([
      response('max_tokens', [mcpUse('a'), mcpResult('a'), { ...finalize, input: { jobs: [] } }]),
      response('tool_use', [finalize]),
    ])
    const jobs = await runAgenticSearch(input, client)

    expect(jobs).toHaveLength(1)
    // The truncated finalize call is trimmed from the re-sent turn.
    expect(requests[1].messages[1].content).toEqual([mcpUse('a'), mcpResult('a')])
  })

  it('accepts a truncated finalize_jobs after the recovery, rather than nothing', async () => {
    const { client, create } = fakeClient([
      response('max_tokens', [{ type: 'text', text: 'working' }]),
      response('max_tokens', [finalize]),
    ])
    expect(await runAgenticSearch(input, client)).toHaveLength(1)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('recovers from max_tokens only once', async () => {
    const { client, create } = fakeClient([
      response('max_tokens', [{ type: 'text', text: 'working' }]),
      response('max_tokens', [{ type: 'text', text: 'still working' }]),
    ])
    expect(await runAgenticSearch(input, client)).toEqual([])
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('stops after 4 requests', async () => {
    const { client, create } = fakeClient(
      Array.from({ length: 5 }, () => response('pause_turn', [mcpUse('x'), mcpResult('x')]))
    )
    expect(await runAgenticSearch(input, client)).toEqual([])
    expect(create).toHaveBeenCalledTimes(4)
  })

  it('returns [] when the model ends without finalizing', async () => {
    const { client } = fakeClient([response('end_turn', [{ type: 'text', text: 'No jobs found.' }])])
    expect(await runAgenticSearch(input, client)).toEqual([])
  })

  it('passes the abort signal to every request', async () => {
    const controller = new AbortController()
    const { client, create } = fakeClient([response('tool_use', [finalize])])
    await runAgenticSearch({ ...input, signal: controller.signal }, client)
    expect(create.mock.calls[0][1]).toEqual({ signal: controller.signal })
  })
})

describe('trimUnansweredToolCalls', () => {
  it('keeps answered MCP calls and drops a trailing unanswered one', () => {
    const content = [mcpUse('a'), mcpResult('a'), mcpUse('b')]
    expect(trimUnansweredToolCalls(content as never)).toEqual([mcpUse('a'), mcpResult('a')])
  })

  it('drops a trailing client tool_use', () => {
    const content = [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't', name: 'finalize_jobs', input: {} }]
    expect(trimUnansweredToolCalls(content as never)).toEqual([{ type: 'text', text: 'ok' }])
  })
})
