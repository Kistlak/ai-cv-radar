# AI CV Radar — Build Plan Overview

App name: **AI CV Radar** (spec calls it JobMatch AI — we use AI CV Radar as the brand)

## What We're Building
A full-stack web app where users upload their CV, enter job search criteria, and receive
a ranked table of matching job postings from LinkedIn, Indeed, Glassdoor, Adzuna, JSearch,
and Remotive — ranked by Claude AI for CV fit — with direct apply links.

## BYOK Model
Users bring their own Anthropic API key and Apify token. The app never pays for API usage.
Keys are encrypted at rest with AES-256-GCM.

## Tech Stack (LOCKED — do not substitute)
- Framework: Next.js 15 (App Router) + TypeScript
- UI: Tailwind CSS v4 + shadcn/ui
- Auth: Supabase Auth (email magic link)
- Database: Supabase Postgres + Drizzle ORM
- File storage: Supabase Storage
- LLM: @anthropic-ai/sdk, model claude-sonnet-4-5
- Scraping: apify-client (LinkedIn, Indeed, Glassdoor)
- Free APIs: Adzuna, JSearch (RapidAPI), Remotive
- CV parsing: pdf-parse + Claude
- Validation: Zod everywhere
- Forms: react-hook-form + Zod resolver
- Encryption: Node crypto AES-256-GCM
- Deployment: Vercel + Supabase

## Build Phases
| Phase | Focus | Status |
|-------|-------|--------|
| 1 | Foundation — project scaffold, Supabase, DB schema, auth | NOT STARTED |
| 2 | API Keys — BYOK encryption, settings page | NOT STARTED |
| 3 | CV Upload & Parse — PDF → Claude → structured JSON | NOT STARTED |
| 4 | Job Sources — Remotive, Adzuna, JSearch, Apify (LI/Indeed/GD) | NOT STARTED |
| 5 | Matching + Search Endpoint — full pipeline, dedup, ranking | NOT STARTED |
| 6 | Search UI — search form, results table, history view | NOT STARTED |
| 7 | Polish & Deploy — error boundaries, toasts, skeletons, Vercel | NOT STARTED |

## Non-Negotiables
1. RLS on every Supabase table
2. API keys encrypted at rest, never in plaintext in DB/logs/client
3. Never send user's API keys to the browser after saving
4. All Anthropic/Apify calls server-side only
5. Zod validation at every API boundary
6. Handle partial failures (if 2/6 sources fail, return results from 4 that worked)
7. No `any` types — strict TypeScript throughout
8. Idempotent searches — same params within 10 min returns cached results

## Session Continuity
See `.agent/session.md` for where the current session left off.
