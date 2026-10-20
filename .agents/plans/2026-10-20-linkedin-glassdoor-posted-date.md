# Plan: LinkedIn and Glassdoor posting dates (and the output mapping behind them)

**Status**: Completed (2026-10-20), scope B + the input fixes (C) after review "fix all". Review: `.agents/plans/reviews/2026-10-20-linkedin-glassdoor-posted-date-review.md`
**Date**: 2026-10-20
**Branch**: `fix/linkedin-glassdoor-posted-date` (stacked on `fix/indeed-posted-date`, same file)
**Related**: follow-up from `.agents/plans/2026-10-15-indeed-posted-date.md` (Out of Scope: "LinkedIn and Glassdoor dates"). No PRD; it's a one-file fix.

## Task Summary
Check whether LinkedIn and Glassdoor jobs have the same problem as Indeed: a posting date that never parses, so the 30-day freshness filter can't drop old jobs and cards show no "Posted N days ago".

## Findings
Sources:
- the latest public build of each actor, read from the Apify API on 2026-10-20 (dataset views and README sample output);
- LinkedIn: `bebity/linkedin-jobs-scraper` build 0.0.226;
- Glassdoor: `bebity/glassdoor-jobs-scraper` build 0.1.66.

Both mappings in `lib/job-sources/apify.ts` date from the first commit (`3a0080f`, 2026-04-19) and were never checked against the actors' output.

**LinkedIn: the date is broken, the rest mostly works.**
- We read `postedAt`. The actor has no `postedAt`; it sends:
  - `postedTime`: display text ("3 days ago");
  - `publishedAt`: a date ("2026-08-29");
  - `postedAtTimestamp`: epoch ms, only with the paid `enrichCompany` add-on.
- So every LinkedIn job has `posted_at = NULL`, the same bug as Indeed.
- Other fields:
  - `title`, `companyName`, `location`, `workType`, `description` and `applyUrl` match.
  - `link` doesn't exist; the actor's job link is `jobUrl`.
  - `salaryInfo` doesn't exist; the actor sends `salary`.
- So the effects are:
  - every job has no date;
  - every salary is empty;
  - jobs without an external `applyUrl` (LinkedIn Easy Apply) are probably skipped, since `link` never exists to fall back on.

**Glassdoor: the whole mapping doesn't match, not just the date.**
- The actor's rows are snake_case: `job_title`, `company_name`, `job_url`, `job_apply_url`, `job_posted_date` ("2026-08-19T00:00:00"), `job_age_in_days`, `job_description`, `job_location.unknown`, `job_remote`, `job_salary.*`, `job_expired`.
- Its README says these are the names the *previous* Glassdoor scraper used too.
- We read camelCase names (`jobTitle`/`title`, `companyName`/`employer`, `jobLink`/`url`), and none of them exist.
- So, if the schema is right, every Glassdoor item fails the title/company/apply-URL check and is skipped, and **Glassdoor returns 0 jobs on every search**. A date fix alone would change nothing.
- Not confirmed with a live run: the blocked check from the Indeed task applies here too.

**Inputs have drifted as well** (the known T6 follow-up; not part of this plan unless you say so):
- LinkedIn's input is now `titles`, `locations`, `startUrls`, `rows`, `publishedAt`. We send `urls`, `count` and `scrapeCompany`, which aren't in its schema.
- Glassdoor's input has `maxItems` and `postedWithinDays`. We send `maxResults`, which isn't in its schema; `searchUrls` is still valid.

## Proposed scope (option B in Question 1)
Fix the **output mapping** for both actors, so their jobs come through with dates:

**LinkedIn** (`BebityLinkedInJob` and `fetchApifyLinkedIn`):
- `postedAt: parseDate(item.publishedAt) ?? parseDate(item.postedAt)`. `postedTime` is display text and is not parsed (same decision as Indeed).
- Link: `item.applyUrl ?? item.jobUrl ?? item.link`, so external apply links are still preferred, as now.
- Salary: also read `item.salary` when `salaryInfo` is missing.
- The old field names are kept as fallbacks, so nothing that works today stops working.

**Glassdoor** (`BebityGlassdoorJob` and `fetchApifyGlassdoor`):
- Title, company and link: add `job_title`, `company_name`, and `job_apply_url ?? job_url`, ahead of the existing names.
- Date: `parseDate(item.job_posted_date) ?? parseDate(item.postedAt)`.
- Location: `job_location.unknown`. Remote: `job_remote`, or "remote" in the location.
- Description: `job_description`.
- Skip `job_expired: true` rows, like Indeed's `isExpired`.
- Salary: `job_salary` is an object. I'd format it as text ("$73 hourly", "$70,000–$90,000 per year"), matching how the other sources fill the `salary` text field. Alternatively we can leave salary empty for now (Question 3).

## Affected Files
- `lib/job-sources/apify.ts`: the two interfaces and the two mapping loops. `fetchApifyIndeed`, `runActor` and `parseDate` are unchanged.
- `tests/unit/apify-linkedin-glassdoor.test.ts` (new): fake `apify-client` like `apify-indeed.test.ts`, using the README sample rows.
- Docs: this plan and its review.

## Current Behavior to Preserve
- Actor inputs are unchanged (unless Question 2 says otherwise).
- Every currently read field name still works as a fallback.
- Rows missing a title, company or link are still skipped.
- The id fallback (`id ?? applyUrl`) is kept.
- Remote detection from the location text is kept.
- Indeed mapping is unchanged.
- `parseDate` is unchanged: non-strings, empty strings and invalid dates give null.
- Jobs with no usable date are still kept by the freshness filter.

## Out of Scope
- Actor inputs (Question 2).
- Parsing display text ("3 days ago").
- `postedAtTimestamp`: paid add-on, and `publishedAt` already gives the day.
- Backfilling stored rows.
- Company ratings and the other extra Glassdoor fields.

## Edge Cases & Risks
- **Timezone:** Glassdoor's `job_posted_date` has no timezone ("2026-08-19T00:00:00"), so `new Date()` reads it as server-local time. LinkedIn's `publishedAt` ("2026-08-29") is read as UTC midnight. Either way it's off by hours at most; "Posted N days ago" could be one day off near midnight. That's acceptable; noted in the review.
- **More results:** if Glassdoor really returns 0 jobs today, this turns it on. Searches would get up to 25 more jobs into the scoring pool. That's more AI scoring work and possibly slower searches, within the existing pool cap.
- **Not live-verified:** the fix rests on the published schema. A real run is still needed (see the Indeed check options).

## Testing Strategy
- **LinkedIn:**
  - a README-shaped row gets the `publishedAt` date, the `salary` text and its link;
  - an Easy Apply row (no `applyUrl`) falls back to `jobUrl`;
  - a row with only display text has no date.
- **Glassdoor:**
  - a README-shaped row is mapped: title, company, apply link, date, location, remote, description, salary;
  - an expired row is skipped;
  - an old camelCase row still maps as today.
- **Regression:** lint, typecheck and the full `npm test`, after asking.
- **Manual:** one real search with LinkedIn and Glassdoor selected.

## Questions for you
1. **Scope.**
   - **A:** dates only. That fixes LinkedIn dates; Glassdoor stays at (probably) 0 jobs.
   - **B (recommended):** fix both output mappings as above.
   - **C:** B plus the input fixes (bigger, and it changes what the actors are asked for).
2. **Have you ever seen a Glassdoor job in the results?** If yes, the schema finding is wrong somewhere and I'll dig further before coding.
3. **Glassdoor salary:** format the `job_salary` object as text (recommended), or leave it empty for now?

## Outcome (2026-10-20)
- **Answers:**
  - Q1 scope B, Q3 salary as text (approved with "ok").
  - Q2 not answered; the published schema was taken as correct.
  - The review's "fix all" then added the input fixes, so the final scope is **C**.
- **Reproduced:** the new tests failed before the fix (4 of 8: LinkedIn date and Easy Apply link; every Glassdoor row skipped).
- **Output mapping:** as planned, with these deviations:
  - LinkedIn link order kept as `link ?? applyUrl ?? jobUrl` (smaller diff, same result);
  - Glassdoor `sourceJobId` prefers `job_id`;
  - Glassdoor salary formatter `formatGlassdoorSalary` ("$70k–$90k per year", "$73 per hour (estimate)").
- **Inputs** (from the review):
  - LinkedIn `urls`/`count`/`scrapeCompany` → `startUrls: [{ url }]`, `maxRowsPerUrl: 25`, `companyProfile: false`;
  - Glassdoor `maxResults: 25` → `maxItems: 25`;
  - tested by checking what the fake client is started with.
- **Checks:**
  - `npm run lint`: 0 errors, 1 existing warning, not in this diff;
  - `npm run typecheck`: clean;
  - `npm test`: 27 files, 310 tests passed.
- **Still open:**
  - one real search with LinkedIn and Glassdoor selected (not live-verified);
  - Indeed's input (`maxItems` vs the actor's current name) wasn't checked here;
  - no backfill of stored rows.
