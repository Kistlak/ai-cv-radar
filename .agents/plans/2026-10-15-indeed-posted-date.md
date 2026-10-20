# Plan: Fix Indeed posting dates (always empty)

**Status**: Completed (2026-10-20). Review approved with no changes: `.agents/plans/reviews/2026-10-20-indeed-posted-date-review.md`
**Date**: 2026-10-15
**Branch**: `fix/indeed-posted-date` (new, from `origin/master` at `4ab2ca8`)
**Related**: found in the T6 review (`.agents/plans/reviews/2026-10-14-match-quality-t6-freshness-review.md`, Note "Indeed jobs are never filtered"). No PRD; it's a one-file bug fix.

## Task Summary
Every Indeed job is stored with `posted_at = NULL`. Because of that:
- the T6 freshness filter keeps them all, even months-old postings;
- the cards show no "Posted N days ago" for Indeed jobs.

**Root cause** (confirmed):
- `fetchApifyIndeed` (`lib/job-sources/apify.ts:187`) maps `postedAt: parseDate(item.postedAt)`.
- In `misceres/indeed-scraper`'s output, `postedAt` is the age **as Indeed displays it**: "Today", "Just posted", "3 days ago", "30+ days ago".
  - The actor's dataset schema (build 0.0.117) describes it as "Age of the job listing as displayed on Indeed (e.g. '3 days ago')".
  - `new Date()` turns every one of those strings into an Invalid Date, so `parseDate` returns null. All five forms were checked in Node.
- The same schema has **`postingDateParsed`**: "ISO 8601 date when the job was posted", for example `2025-01-15T12:00:00.000Z`. We never read it.

**Reproduction:** `tests/unit/apify-indeed.test.ts` (new) runs `fetchApifyIndeed` against a fake `apify-client`, with an item that has `postedAt: '3 days ago'` and `postingDateParsed: '2026-10-12T09:00:00.000Z'`. It expects that ISO date. It's written but not run yet; running it, with your OK, should show it failing.

## Affected Files
- **`lib/job-sources/apify.ts`:**
  - `MisceresIndeedJob` gets `postingDateParsed?: string`;
  - the mapping becomes `postedAt: parseDate(item.postingDateParsed) ?? parseDate(item.postedAt)`.

  The `postedAt` fallback is kept in case the actor ever puts a real date there. That's one line plus the interface field.
- **`tests/unit/apify-indeed.test.ts`** (new): the reproduction, plus two guard cases:
  - only the displayed age → null, as today;
  - an unparseable `postingDateParsed` → null.
- **Docs:** this plan and its review.

## Current Behavior to Preserve
- the Indeed actor input, `isExpired` skipping, the required title, company and apply URL, the id fallback, remote detection, salary and description;
- `parseDate`: non-strings, empty strings and invalid dates give null;
- LinkedIn and Glassdoor mapping (same file): unchanged;
- jobs with no usable date are still kept by the freshness filter.

## Out of Scope
- **Parsing the displayed age** ("3 days ago", "30+ days ago") when `postingDateParsed` is missing.
  - It would need a reference time (`scrapedAt`), and "30+" is only a lower bound.
  - That's question 1.
- **LinkedIn and Glassdoor dates.** Their actors might have similar display-text fields. That isn't verified here, and it could be a follow-up check.
- **The Apify input drift** (`maxItems` vs `maxItemsPerSearch` and others). It's a separate follow-up from T6.
- **Backfilling** `posted_at` for Indeed rows already stored.

## Approach
1. **Reproduce:** run `tests/unit/apify-indeed.test.ts` and confirm the first case fails (null vs the ISO date). I'll ask you before running it.
2. **Wait** for your confirmation of the root cause (bug-fix protocol).
3. **Fix:** the one-line mapping change and the interface field.
4. **Checks:** run lint, typecheck and `npm test`, after asking you.
5. **Review doc**, then the summary.

## Database Changes
None.

## API Endpoints
None.

## Edge Cases & Risks
- **The actor omits `postingDateParsed`** for some listings: the date stays null, as today. That's no regression.
- **The actor sends a bad value** in `postingDateParsed`: `parseDate` rejects it, so the date is null (tested).
- **Effect on results:** Indeed jobs older than `JOB_MAX_AGE_DAYS` (30) are now dropped, which is the intended T6 behaviour. A search that leans on Indeed may show fewer, fresher results.
- **Timezone:** the ISO string carries a `Z`, so it parses as UTC with no ambiguity.

## Testing Strategy
- **The reproduction case:** `postingDateParsed` wins over the displayed "3 days ago". It fails before the fix and passes after.
- **"Today" and no ISO field:** null, as now.
- **An invalid ISO field:** null.
- **Regression:** the full `npm test` run.
- **Manual:** one real Indeed search with an Apify key, then check that Indeed cards show "Posted N days ago".

## Questions for you
1. **When `postingDateParsed` is missing**, should I also parse the displayed age ("Today", "Just posted", "N days ago", "30+ days ago") relative to `scrapedAt`?
   - I recommend **not** doing that now. The ISO field covers it, and the fallback adds a small parser for an edge case we haven't seen.
   - Say if you want it anyway.

## Outcome (2026-10-20)
- **Question 1:** answered by default as recommended. There's no parsing of the displayed age ("3 days ago") when `postingDateParsed` is missing.
- **Reproduced:** the new test failed before the fix (1 failed, 2 passed; received `undefined`).
- **Fixed as planned:** the `postingDateParsed` field and the one-line mapping change in `lib/job-sources/apify.ts`. No deviations.
- **Checks:**
  - `npm run lint`: 0 errors, 1 existing warning (React Hook Form `watch()`), not in this diff;
  - `npm run typecheck`: clean;
  - `npm test`: 26 files, 300 tests passed.
- **Still open:**
  - the manual check (a real Indeed search with an Apify key);
  - the follow-ups listed under Out of Scope.
