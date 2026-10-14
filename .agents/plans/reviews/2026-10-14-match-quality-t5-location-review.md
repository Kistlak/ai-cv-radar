# Code Review: Match quality T5: location (every-country matching, CV location prefill)
**Date**: 2026-10-14
**Status**: Approved (2026-10-14), no changes requested. Remote-only searches keep sending the CV location (Important item, kept as designed). The suggestions and notes are left for follow-up tasks.
**Plan**: `.agents/plans/2026-10-14-match-quality-t5-location.md`
**Branch**: `feature/match-quality-t5-location` (stacked on `feature/match-quality-t6-freshness`)

## Summary
The change follows the plan:
- `matchCountry` now recognises every ISO country, through the `Intl.DisplayNames` names plus aliases, cities and US-state guards;
- Indeed uses a 62-country allowlist;
- the search form prefills Location from the CV, with a hint.

These checks pass:
- lint: 0 errors, plus the same 1 warning in `components/search-form.tsx` that was already there (`watch()` and the React Compiler, not touched here);
- `tsc`;
- `npm test`: 297 of 297;
- `next build`.

Nothing blocks a merge. One behaviour point needs your decision: remote-only searches now send the CV location too (see Important).

**Deviations from the plan, and findings during implementation:**
- **More deprecated codes excluded:**
  - `Intl` also names deprecated codes that duplicate current countries: VD "Vietnam", HV "Burkina Faso", DY "Benin", NH "Vanuatu", RH "Zimbabwe", and UK "United Kingdom";
  - VD was caught by a test, because "Vietnam" matched `vd`;
  - all six were added to `NOT_COUNTRIES`.
- **`&` → `and` moved into the shared `normalize()`**, so it also applies to the user's input. Before the move, "Bosnia & Herzegovina" didn't match; a test caught it.
- **US cities added:** Atlanta, Denver, Miami, Dallas, Houston and Washington DC. That way "Atlanta, Georgia" stays in the US, as the plan's test list expects.
- **A false-positive sweep** was run over 43 common strings, from a temporary test file that was deleted afterwards:
  - "Remote", "Worldwide", "EMEA", "Europe", "Latin America", "Norfolk, Virginia", "San Jose, CA" and similar stay unrecognised;
  - the short names map as expected: Jordan → jo, Chad → td, Oman → om, Peru → pe.

## Issues Found

### Critical (must fix before merging)
None.

### Important (should fix)
- [Behaviour] `components/search-form.tsx` + `lib/job-sources/adzuna.ts:30-41`: **remote-only searches now send the CV location as well.**
  - The Location input is disabled only visually when Remote only is on, and react-hook-form still submits its value.
  - Before T5, the field was empty by default, so a remote-only search had no location. Now it has the CV's.
  - Effects:
    - **Adzuna** searches the CV country's index with `where=<location>` and `what_and=remote`, or skips Adzuna when it doesn't cover that country. Before, it searched the UK index.
    - **Indeed** searches the CV country with location "Remote". Before, it searched the US.
    - **LinkedIn, Glassdoor and JSearch** are unchanged, because they ignore the location when remote-only is on.
    - **Scoring** is unchanged, because T3 already fell back to the CV location.
  - This is the same as a user typing a location and then ticking Remote only, which was possible before. It also fits G3: remote jobs open to the candidate's country.
  - The risk: Adzuna's `where` filter could narrow remote results to that city.
  - **Options:**
    - keep it (my recommendation, consistent with G3);
    - or send `location` only when Remote only is off, with a one-line change in `onSubmit`. Scoring would still use the CV location, through T3's fallback.

### Suggestions (nice to have)
- [Improvement] `components/search-form.tsx` (`suppressFetchRef`): in dev, React StrictMode runs effects twice, so one Photon call can still happen on load. Production is unaffected. This is known and listed in the plan.
- [Test coverage] `lib/job-sources/country.ts` (`getCountryNames`):
  - a test that no two remaining codes share a name would catch a future ICU version adding another deprecated duplicate, like VD did;
  - it needs a small export of the built list, or a test-only helper.
- [Note] **Quirks that were already there** (the first matching pattern wins), confirmed by the sweep:
  - "US or Canada" → ca, because the ca pattern comes before us;
  - "Paris, Texas" → fr.

  Both behaved the same before T5. They're listed in the plan as out of scope.
- [Note] **"Turkey Creek" → tr**, an edge case of the `turkey` alias. This kind of US place name in a search location is rare.
- [Note] **Bare "Georgia" → ge**, as decided. "Atlanta, Georgia" and "Georgia, USA" map to us.
- [Note] **`normalize()` is applied to the existing patterns' input too.** Two effects:
  - "Zürich" and "Kraków" now match, where before they didn't;
  - the accented alternative `são paulo` in the `br` pattern can no longer match, because accents are stripped first. It was left as it is to keep the diff small, and `sao paulo` covers it.

## Checklist
- [x] No SQL injection risks: no queries changed
- [x] No mass assignment vulnerabilities: no new write paths
- [x] No exposed secrets or hardcoded credentials
- [x] No N+1 query problems: the search page still makes one `getActiveCv` call
- [x] Missing indexes on frequently queried columns checked: not applicable
- [x] Error handling covers edge cases:
  - an invalid or missing `structured` CV means no prefill;
  - a location over 100 characters isn't prefilled;
  - `Intl` returns no name for unknown codes, and those are skipped.
- [x] Validation rules are complete: the CV JSON is read through `CvStructuredSchema.safeParse`, and the API still limits location to 100 characters
- [x] Authorization checks are in place: `getActiveCv(user.id)` is unchanged
- [x] No unhandled promise rejections
- [x] No memory leaks in useEffect: the existing effect is unchanged, and only the ref's start value changed
- [x] Large collections use chunking, not ->all(): not applicable
- [x] Tests cover the main scenarios: new countries, variants and accents, collisions, US guards, exclusions, the Indeed allowlist, and Adzuna skips
- [x] No existing features were removed or broken: every earlier country, Indeed, Adzuna and currency assertion passes unchanged
- [x] No unrelated files were modified (`next-env.d.ts` was restored after `next build`)
