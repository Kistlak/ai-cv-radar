# AGENTS.md: working on AI CV Radar

Guidance for AI coding agents (and humans) working in this repo. `CLAUDE.md`
imports this file.

## Stack
- Next.js 16 (App Router) + React 19, TypeScript, Tailwind 4, shadcn/base-ui.
- Supabase (auth + storage) and Postgres via Drizzle ORM (`db/schema.ts`). The app
  connects as `postgres`, so **RLS doesn't apply**: every query must filter by the
  signed-in user. Use `requireUser()` (`lib/auth.ts`) in route handlers.
- AI: Anthropic or Gemini through `lib/ai/*` (`AiClient`). The agentic Apify
  search (`lib/agentic-search.ts`) uses Claude + the Apify MCP server.
- Validate every stored AI response with the zod schemas in `lib/ai/schemas.ts`.
- Treat job data as untrusted: `toHttpUrl()` for links, `untrusted()` and
  `<job_posting>` tags in prompts.

## Commands
```bash
npm run dev               # dev server
npm run lint              # ESLint
npm run typecheck         # tsc --noEmit
npm test                  # unit tests (Vitest, tests/unit) - CI runs these
npm run test:integration  # cross-user tests against DATABASE_URL (tests/integration) - never in CI
npm run test:e2e          # Playwright
npm run db:apply -- supabase/migrations/<file>.sql   # apply one migration
```
Run lint, typecheck and `npm test` before every commit. Run `next build` for
anything touching routes, config or dependencies.

## Database
- SQL files in `supabase/migrations/` are the source of truth. Add a new file
  per change and never edit an applied one. Keep `db/schema.ts` in sync. Never
  `drizzle-kit push` against the hosted DB. Details are in
  `supabase/migrations/README.md`.
- Ask before running anything that writes to the hosted DB.

## Workflow docs
- PRDs: `.agents/prd/`. Task plans: `.agents/plans/`. Reviews: `.agents/plans/reviews/`.
- Read the relevant PRD and plans before starting work in an area.

## Git
- Commits in this repo are authored as **Kistlak Rajapaksha
  <kistlakall@gmail.com>** (set in this repo's local git config).
- Remote: GitHub `Kistlak/ai-cv-radar`. Pushing a branch opens a PR to `master`
  automatically (`.github/workflows/auto-pr.yml`). Don't merge directly; merge
  PRs on GitHub with "Create a merge commit" when PRs are stacked.
