import Anthropic from '@anthropic-ai/sdk'
import type { RawJob } from './job-sources/types'

const APIFY_MCP_URL = process.env.APIFY_MCP_URL || 'https://mcp.apify.com'
const AGENT_MODEL = process.env.AGENT_MODEL || 'claude-sonnet-4-6'
const AGENT_MAX_TOKENS = Number(process.env.AGENT_MAX_TOKENS || 16000)
const MCP_BETA = 'mcp-client-2025-11-20'

export interface AgenticSearchInput {
  cvText: string
  userQuery: string
  location?: string
  remoteOnly: boolean
  maxResults?: number | null
  anthropicKey: string
  apifyToken: string
}

interface FinalizeJobsInput {
  jobs?: Array<{
    source?: string
    sourceJobId?: string
    title?: string
    company?: string
    location?: string
    remote?: boolean
    salary?: string
    postedAt?: string
    description?: string
    applyUrl?: string
  }>
  summary?: string
}

const FINALIZE_JOBS_TOOL = {
  name: 'finalize_jobs',
  description:
    'Call this exactly once at the end, after you have gathered a strong set of relevant, recent job postings for the candidate. This is how you return your final ranked list. Do not call this before running at least one Apify tool.',
  input_schema: {
    type: 'object' as const,
    properties: {
      jobs: {
        type: 'array',
        description:
          'Curated, ranked list of jobs. Every item must come from a tool result — do not invent jobs.',
        items: {
          type: 'object',
          properties: {
            source: {
              type: 'string',
              description:
                'One of: linkedin, indeed, glassdoor. Use the actor name if none of those fit.',
            },
            sourceJobId: {
              type: 'string',
              description: 'Stable identifier from the source (id field if present, else the apply URL).',
            },
            title: { type: 'string' },
            company: { type: 'string' },
            location: { type: 'string', description: 'Empty string if unknown.' },
            remote: { type: 'boolean' },
            salary: { type: 'string', description: 'Empty string if unknown.' },
            postedAt: { type: 'string', description: 'ISO8601 if known, else empty string.' },
            description: {
              type: 'string',
              description: 'Short, relevant excerpt of the job description (<1000 chars).',
            },
            applyUrl: { type: 'string', description: 'URL the candidate uses to apply.' },
          },
          required: ['source', 'sourceJobId', 'title', 'company', 'applyUrl'],
        },
      },
      summary: {
        type: 'string',
        description: 'One or two sentences on the queries you tried and why you stopped.',
      },
    },
    required: ['jobs'],
  },
}

function buildSystemPrompt(targetCount: number | null): string {
  const countLine = targetCount
    ? `Goal: return exactly ${targetCount} genuinely relevant, recent job postings that fit this specific candidate's CV and target role. If you cannot find ${targetCount} strong matches, return fewer — never pad.`
    : `Goal: return 15–30 genuinely relevant, recent job postings that fit this specific candidate's CV and target role.`
  return `You are an agentic job-search assistant.
${countLine}

You have access to Apify tools (via the "apify" MCP server). Use actors like the LinkedIn, Indeed, and Glassdoor job scrapers. If you are unsure which actor exists, list the available tools first.

How to work:
1. Read the CV and the candidate's target role (or infer it from the CV if not specified).
2. Pick ONE tight query and call an Apify actor.
3. Inspect what came back. If the results are off-target (wrong stack, wrong seniority, irrelevant titles), DO NOT keep them — refine the query (different wording, narrower title, different country) and try again with another actor.
4. Prefer 2–3 solid searches across different actors over one broad one.
5. When you have a strong set, call finalize_jobs exactly once.

Hard rules:
- Never invent jobs. Every item you finalize must come from a tool result you actually saw.
- Do not pad with irrelevant jobs just to hit the count. 12 great jobs beat 30 mediocre ones.
- Do not call finalize_jobs before you have run at least one Apify tool.
- Do not ask the user clarifying questions — work with what you have.`
}

function buildUserPrompt(input: AgenticSearchInput): string {
  const lines: string[] = []
  lines.push('CANDIDATE CV:')
  lines.push(input.cvText.slice(0, 6000))
  lines.push('')
  const q = input.userQuery.trim()
  lines.push(
    q
      ? `Target role (explicit): ${q}`
      : 'Target role: not specified — infer the best-fit role(s) from the CV.'
  )
  if (input.location) lines.push(`Preferred location: ${input.location}`)
  if (input.remoteOnly) lines.push('Candidate wants remote-only roles.')
  lines.push('')
  lines.push('Work the loop now. Call finalize_jobs when you have a strong set.')
  return lines.join('\n')
}

function parsePostedAt(raw?: string): Date | null {
  if (!raw) return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d
}

function normalizeSource(s?: string): string {
  const v = (s || '').toLowerCase()
  if (v.includes('linkedin')) return 'linkedin'
  if (v.includes('indeed')) return 'indeed'
  if (v.includes('glassdoor')) return 'glassdoor'
  return v || 'agentic'
}

function toRawJobs(payload: FinalizeJobsInput): RawJob[] {
  if (!Array.isArray(payload.jobs)) return []
  const jobs: RawJob[] = []
  for (const j of payload.jobs) {
    if (!j.title || !j.company || !j.applyUrl) continue
    jobs.push({
      source: normalizeSource(j.source),
      sourceJobId: j.sourceJobId || j.applyUrl,
      title: j.title,
      company: j.company,
      location: j.location && j.location.trim() ? j.location : null,
      remote: j.remote === true,
      salary: j.salary && j.salary.trim() ? j.salary : null,
      postedAt: parsePostedAt(j.postedAt),
      description: j.description && j.description.trim() ? j.description : null,
      applyUrl: j.applyUrl,
    })
  }
  return jobs
}

export async function runAgenticSearch(input: AgenticSearchInput): Promise<RawJob[]> {
  const client = new Anthropic({ apiKey: input.anthropicKey })

  console.log(
    `[agentic-search] model=${AGENT_MODEL} mcp=${APIFY_MCP_URL} query="${input.userQuery}" location="${input.location ?? ''}" remote=${input.remoteOnly}`
  )

  const response = await client.beta.messages.create({
    model: AGENT_MODEL,
    max_tokens: AGENT_MAX_TOKENS,
    system: buildSystemPrompt(input.maxResults ?? null),
    messages: [{ role: 'user', content: buildUserPrompt(input) }],
    mcp_servers: [
      {
        type: 'url',
        url: APIFY_MCP_URL,
        name: 'apify',
        authorization_token: input.apifyToken,
      },
    ],
    tools: [
      { type: 'mcp_toolset', mcp_server_name: 'apify' },
      FINALIZE_JOBS_TOOL,
    ],
    betas: [MCP_BETA],
  })

  let mcpCalls = 0
  for (const block of response.content) {
    if (block.type === 'mcp_tool_use') mcpCalls++
  }
  console.log(
    `[agentic-search] stop_reason=${response.stop_reason} mcp_calls=${mcpCalls} input_tokens=${response.usage.input_tokens} output_tokens=${response.usage.output_tokens}`
  )

  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === 'finalize_jobs') {
      const jobs = toRawJobs(block.input as FinalizeJobsInput)
      console.log(`[agentic-search] finalized ${jobs.length} jobs`)
      return jobs
    }
  }

  console.warn('[agentic-search] model did not call finalize_jobs — returning empty result')
  return []
}
