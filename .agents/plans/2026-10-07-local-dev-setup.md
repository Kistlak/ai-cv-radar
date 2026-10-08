# Local Dev Setup — run AI CV Radar on this laptop

**Status**: Completed
**Date**: 2026-10-07

## Task Summary
Make the project runnable locally (Windows 11, Node 22.18) against an existing hosted Supabase project.

## Affected Files
- `.env.local` (new, gitignored) — Supabase keys, DATABASE_URL, generated APP_ENCRYPTION_KEY
- `.env.local.example` — document the optional env vars the code already reads (commented out)

No application code changes.

## Current Behavior to Preserve
- All app code, schema, migrations, auth flow untouched.
- Existing required env var names unchanged.

## Out of Scope
- Model ID defaults, `CLAUDE.md` -> missing `AGENTS.md`, Playwright F: drive comment, `.agent/` vs `.agents/` folders.
- Authenticated e2e coverage.

## Approach
1. `npm install`
2. Create `.env.local` from user-provided Supabase credentials + generated `APP_ENCRYPTION_KEY` (32 random bytes, base64).
3. Check hosted DB state; `npx drizzle-kit push` to create/sync tables from `db/schema.ts`.
4. Apply `supabase/policies.sql` (skip policies that already exist).
5. Create private Storage bucket `cvs` (via service-role key) if missing.
6. Supabase dashboard (user): Auth → URL Configuration → add `http://localhost:3000/auth/callback` to Redirect URLs (magic-link).
7. Verify: `npx tsc --noEmit`, `npm run lint`, `npm run build`, start `npm run dev`, hit `/` and `/login`.
8. Optional: `npx playwright install chromium` + `npm run test:e2e`.

## Database Changes
Schema push from existing `db/schema.ts` only (no new migrations).

## Edge Cases & Risks
- If the hosted DB already has data, `drizzle-kit push` may prompt on destructive diffs — abort and report rather than accept.
- `DATABASE_URL` should use the Supabase pooler (port 6543, transaction mode) — `db/index.ts` already sets `prepare: false`.
- Magic-link emails use Supabase's default SMTP (rate-limited ~2/hour) unless custom SMTP is configured.

## Testing Strategy
Typecheck, lint, production build, dev-server smoke (landing, login, protected route redirect), Playwright smoke suite.

## Outcome (2026-10-07)
- `npm install` OK (npm audit reports 39 vulns — not addressed, out of scope).
- Hosted DB already had all 5 tables matching `db/schema.ts` and the private `cvs` bucket + storage policy -> no `drizzle-kit push` needed.
- RLS was disabled on all public tables -> applied the table section of `supabase/policies.sql` (RLS on + 5 policies). App is unaffected: all table access is via Drizzle as the `postgres` role.
- `tsc` clean, lint 0 errors / 1 warning (react-hook-form `watch` vs React Compiler), `npm run build` OK.
- Dev server: `/` 200, `/login` 200, `/dashboard` & `/settings` 307 -> `/login`.
- Deviation: `.env.local` uses Supabase direct connection (port 5432) instead of the pooler — works on this network.
- Note: `SUPABASE_SERVICE_ROLE_KEY` is not read anywhere in the code.
- Playwright browsers not installed / e2e not run.
