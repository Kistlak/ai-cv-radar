# Phase 1 — Foundation

**Status:** NOT STARTED
**Goal:** Scaffold the project, set up Supabase, write DB schema, wire auth, verify login works.

## Steps

- [ ] 1. Scaffold Next.js 15 app
  ```
  npx create-next-app@latest . --typescript --tailwind --app --eslint
  ```
  (Run inside `ai-cv-radar/` root — use `.` not a new subfolder since repo already exists)

- [ ] 2. Install all dependencies
  ```
  npm install @supabase/supabase-js @supabase/ssr drizzle-orm drizzle-kit postgres \
    zod react-hook-form @hookform/resolvers @anthropic-ai/sdk apify-client pdf-parse
  npm install -D @types/pdf-parse
  ```

- [ ] 3. Install shadcn/ui
  ```
  npx shadcn@latest init
  npx shadcn@latest add button input form card table dialog sonner badge tabs
  ```

- [ ] 4. Create `.env.local.example` with keys:
  - NEXT_PUBLIC_SUPABASE_URL
  - NEXT_PUBLIC_SUPABASE_ANON_KEY
  - SUPABASE_SERVICE_ROLE_KEY
  - DATABASE_URL
  - APP_ENCRYPTION_KEY
  - NEXT_PUBLIC_APP_URL=http://localhost:3000
  Copy to `.env.local` and fill in real Supabase values.

- [ ] 5. Write Drizzle schema at `src/db/schema.ts`
  Tables:
  - `profiles` (id uuid PK = auth.users.id, email, created_at)
  - `user_api_keys` (user_id PK FK, anthropic_key, apify_token, adzuna_app_id, adzuna_app_key, rapidapi_key, updated_at)
  - `cvs` (id, user_id FK, file_path, raw_text, structured jsonb, is_active, created_at)
  - `searches` (id, user_id FK, cv_id FK, query, location, remote_only, sources text[], status, error, created_at, completed_at)
  - `job_results` (id, search_id FK CASCADE, source, source_job_id, title, company, location, remote, salary, posted_at, description, apply_url NOT NULL, match_score, match_reason, created_at)
    + INDEX (search_id, match_score DESC)
    + UNIQUE (search_id, source, source_job_id)

- [ ] 6. Write `drizzle.config.ts`

- [ ] 7. Write `src/db/index.ts` (Drizzle client)

- [ ] 8. Run `npx drizzle-kit push` to create tables in Supabase

- [ ] 9. Write `supabase/policies.sql` — RLS policies for all 4 tables
  Policy: `user_id = auth.uid()` (or `id = auth.uid()` for profiles)

- [ ] 10. Apply RLS policies in Supabase SQL editor

- [ ] 11. Write Supabase helpers:
  - `src/lib/supabase/client.ts` — browser client
  - `src/lib/supabase/server.ts` — server client (uses cookies)
  - `src/lib/supabase/middleware.ts` — session refresh helper

- [ ] 12. Write `src/middleware.ts` — protect `/(app)` routes, redirect to `/login`

- [ ] 13. Create route groups:
  - `src/app/(auth)/login/page.tsx` — email input → magic link
  - `src/app/(auth)/callback/route.ts` — handle magic link callback
  - `src/app/(app)/layout.tsx` — auth guard
  - `src/app/(app)/dashboard/page.tsx` — placeholder with 3 cards
  - `src/app/page.tsx` — landing page

- [ ] 14. Wire auth trigger in Supabase to auto-create `profiles` row on signup
  (SQL function + trigger, or handle in callback route)

## Verify
- Can sign up with a new email
- Magic link arrives, clicking it logs you in
- Authenticated user sees `/dashboard`
- Unauthenticated request to `/dashboard` redirects to `/login`
- Tables exist in Supabase with RLS enabled
