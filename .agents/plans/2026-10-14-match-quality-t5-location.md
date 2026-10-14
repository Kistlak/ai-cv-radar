# Plan: Match quality T5: location (every-country matching, CV location prefill)

**Status**: Completed (code), 2026-10-14. Approved with my recommendations on both questions: the hint is kept, bare "Georgia" maps to the country. Review approved with no changes; remote-only searches keep sending the CV location (review, Important). Deviations: six more deprecated `Intl` codes excluded (VD, HV, DY, NH, RH, UK), `&` → `and` moved into the shared `normalize()`, and a few US cities added. Lint, `tsc`, `npm test` (297/297) and `next build` pass. Pending: the manual check (prefill, clearing, no Photon call on load, Adzuna skipped for "Nairobi").
**Date**: 2026-10-14
**Branch**: `feature/match-quality-t5-location`. It's stacked on `feature/match-quality-t6-freshness`, which isn't merged yet, because both tasks edit neighbouring rows of the PRD's task table. Merge T6 first, with "Create a merge commit".
**PRD**: `.agents/prd/PRD-match-quality.md` (Task 5, requirement F5, goal G3, design §6.5)

## Task Summary
T3 already did the scoring part of F5:
- the prompt gets `CANDIDATE LOCATION` (the search location, or else the CV's) and `REMOTE ONLY`;
- ineligible jobs are capped at 20.

Two parts are left:

1. **Recognise every country.**
   - Today `matchCountry` (`lib/job-sources/country.ts`) knows 21 countries by regex. Anything else, for example "Nairobi, Kenya", "Lagos" or "Lisbon", isn't recognised. When that happens:
     - Adzuna falls back to its **UK** index, so a Kenyan search gets UK jobs;
     - Indeed falls back to **US**.
   - After this task, every ISO country is recognised by its English name. The names are generated with `Intl.DisplayNames`, so there's no new dependency. Common aliases and major cities are also covered.
   - A recognised country that a source doesn't cover makes that source **skip** the search, or fall back as it does today. It no longer silently searches the UK or the US.
2. **Prefill the Location field from the CV.**
   - The search form starts with `cvs.structured.location` from the active CV.
   - The user can edit or clear it.
   - A small hint says it came from the CV.

## Affected Files
- **`lib/job-sources/country.ts`:**
  - **`COUNTRY_PATTERNS`** (the overrides) is kept and checked first, in its current order. It's extended with:
    - **major cities** for about 40 more countries. These are mainly the Indeed and Adzuna countries without cities today, plus large job markets: Kenya, Nigeria, Egypt, Pakistan, Bangladesh, the Philippines, Vietnam, Indonesia, Malaysia, Japan, Korea, the Gulf states, Portugal, Ireland, the Nordics, Czechia, Romania, Ukraine, Turkey, Israel, Argentina, Chile, Colombia, Peru, and so on;
    - **aliases**: `turkey`, `czech republic`, `ivory coast`, `holland`, `great britain`/`britain`, `korea`, `burma`, `swaziland`, `macedonia`, `cape verde`, `east timor`, `drc`/`dr congo`, `us`/`u.s.`;
    - **US-state guards** checked before the country names, so they win: `new mexico`, `new jersey`, `jersey city`, `new south wales` → au.
  - **The ISO name map** (new) is built once, lazily, from `Intl.DisplayNames(['en'], { type: 'region' })` over the codes AA–ZZ:
    - it **excludes** non-countries and deprecated codes: EU, EZ, UN, QO, ZZ, XA, XB, AC, CP, DG, EA, IC, TA, AN, BU, CS, DD, FX, NT, SU, TP, YD, YU, ZR;
    - names are **normalised**: lower case, accents removed (`Türkiye` → `turkiye`, `Côte d’Ivoire` → `cote d'ivoire`), `&` → `and`, `St.` → `saint`/`st`, and suffixes such as ` SAR China` and `(Burma)` removed;
    - names are **matched on word boundaries, longest first**. That way "Papua New Guinea" wins over "Guinea", and "South Sudan" over "Sudan".
  - **`matchCountry`**: tries the overrides, then the ISO names. The input is normalised the same way, so `São Paulo` and `Sao Paulo` both match.
  - **`guessCountry` (Indeed)**: the one-entry `INDEED_UNCONFIRMED` set becomes an **`INDEED_COUNTRIES` allowlist**:
    - it holds the 62 codes in `misceres/indeed-scraper`'s `country` enum, read from the actor's build 0.0.117 input schema on 2026-10-14;
    - any other recognised country falls back to `'us'`, as today;
    - all 20 codes Indeed gets today are on the list, so nothing it gets today changes.
  - **`adzunaCountry`** and **`currencySymbol`**: the logic doesn't change. They just see more recognised countries (see Behaviour change).
- **`app/(app)/search/page.tsx`:**
  - reads `CvStructuredSchema.safeParse(activeCv?.structured).data?.location`, trimmed;
  - passes it as `defaultLocation` to `SearchForm`;
  - doesn't prefill when the location is longer than 100 characters, the search API's limit. Otherwise the user would have a form that fails on submit.
- **`components/search-form.tsx`:**
  - a new optional prop, `defaultLocation?: string`;
  - `defaultValues.location` becomes `defaultLocation ?? ''`;
  - `suppressFetchRef` starts as `true` when there's a prefill, so loading the page doesn't call the Photon suggestions API;
  - a one-line hint under the field, "From your CV. Edit or clear it.", shown while the value still equals the prefill.
- **Tests:** `tests/unit/job-sources-country.test.ts`. The existing cases stay. New cases are listed under Testing Strategy.
- **Docs:** this plan, its review, and the PRD's Task 5 row.

There are no DB, API or env changes.

## Current Behavior to Preserve
**`matchCountry`:**
- every existing mapping, for example "London, UK" → gb, "Toronto" → ca and "Dubai" → ae;
- null for blank input and for unknown places (for example "Kandy");
- the override order: when a location names two places, the first override still wins.

**`guessCountry`:**
- `'us'` for blank, unknown and Indeed-unsupported places, so "Colombo" → us;
- the same code as today for all 20 countries mapped today.

**`adzunaCountry`:**
- `'gb'` for blank or unrecognised locations;
- null (skip) for recognised countries Adzuna doesn't index;
- the same code for its 19 countries.

**`currencySymbol`:** unchanged.

**Search form:**
- an empty location when the CV has none;
- clearing the field works;
- remote-only disables the field, as before;
- the suggestions dropdown, keyboard navigation and blur behave as before;
- the query, sources and result-count defaults are unchanged.

**Search page:**
- the "finish setup" state;
- the `hasApify`/`hasAdzuna`/`hasJsearch` props.

**Run-search and scoring:**
- `candidate.location` is still the search location or, if blank, the CV location (from T3).

## Behaviour change (intended)
- A location that names a country we didn't recognise before now affects sources:
  - **Adzuna** skips the search when it doesn't index that country. For example, "Nairobi, Kenya" searched the UK index before; now Adzuna is skipped.
  - **Indeed** gets that country when the actor supports it. For example, "Lisbon" searched the US before; now it searches pt.

  This is the point of G3. Remotive and JSearch don't use the country, so they don't change.
- Users with a location in their CV start with that location filled in. A blank location means the UK/US fallback, so users who don't edit the field now get local results instead of UK/US ones.

## Out of Scope
- **Two-letter codes in locations**, for example "Berlin, DE". Codes like `in`, `it` and `me` are common words, so the false-positive risk is too high.
- **Choosing between two countries in one location**, for example "US or Canada". The first override wins, as today.
- **Ambiguous names:**
  - bare "Georgia" maps to the country (GE). "Atlanta" or "…, USA" still map to us, because overrides win.
  - This is documented as a known ambiguity in the PRD's test notes.
- **Scoring prompt changes.** They were done in T3.
- **Adzuna's country list and currencies.** Adzuna hasn't added indexes.
- **Prefill from anything other than the active CV.** For example, the last search's location isn't used.
- **Apify actor input drift.** It was found in the T6 review and is tracked separately.

## Approach
1. **`country.ts`:**
   - write the normaliser and the lazy ISO name map with its exclusion list;
   - make `matchCountry` try the overrides, then the ISO names;
   - extend the overrides with the cities, aliases and US-state guards;
   - replace `INDEED_UNCONFIRMED` with `INDEED_COUNTRIES`.
2. **Tests** for every case under Testing Strategy.
3. **Search page and form:** add the prefill, the `suppressFetchRef` start value and the hint.
4. **Checks:** run lint, typecheck, `npm test` and `next build`, after asking you first.
5. **Manual check:**
   - the search page shows the CV location;
   - clearing it works;
   - no Photon call happens on load;
   - "Nairobi" skips Adzuna (the `job_source.adzuna_skipped` log).

## Database Changes
None.

## API Endpoints
None. The outbound Adzuna and Indeed requests change their country as described above.

## Edge Cases & Risks
- **The ICU version changes a name.** For example, Node ≤ 18 says "Turkey" and newer versions say "Türkiye".
  - The aliases cover the known renames.
  - The tests only assert stable names and our own aliases, not every ICU string.
- **False positives from short names** such as "Chad", "Jordan", "Oman" or "Niger". Word boundaries plus the location context keep these rare. "Jordan" could be a person's name in free text, but the field holds a location.
- **"Jersey" vs "New Jersey" and "Guinea" vs "Papua New Guinea":** handled by the guards and by matching longest names first. Both are tested.
- **"Mexico" vs "New Mexico":** the guard maps "New Mexico" → us. The existing `/\bmexico\b/` override sits after it, so "Mexico City" still maps to mx.
- **Indeed's enum changes:**
  - a removed code would make the actor reject or ignore the input. We'd only send codes that were in the enum on 2026-10-14.
  - the allowlist has a comment with the date and build number, the same as the existing check from 2026-10-08.
- **A CV location that's messy**, for example a full street address: it's prefilled as is and the user can edit it. Over 100 characters, nothing is prefilled.
- **React StrictMode in dev** runs effects twice, so one Photon call may still happen on load in dev. Production is unaffected.
- **Performance:** about 250 regexes, built once per server process. `matchCountry` runs a few times per search, so the cost is negligible.

## Testing Strategy
- **`matchCountry`, new countries:**
  - "Nairobi, Kenya" → ke and "Lagos" → ng;
  - "Lisbon, Portugal" → pt and "Dublin" → ie;
  - "Tokyo" → jp and "Karachi" → pk;
  - "Buenos Aires" → ar.
- **Name variants and aliases:**
  - "Türkiye" and "Turkey" → tr;
  - "Czech Republic" and "Czechia" → cz;
  - "Côte d'Ivoire" and "Ivory Coast" → ci;
  - "Bosnia and Herzegovina" → ba;
  - "Hong Kong" → hk;
  - "Myanmar" and "Burma" → mm;
  - "Sao Paulo" and "São Paulo" → br.
- **Collisions:**
  - "Papua New Guinea" → pg and "Guinea" → gn;
  - "South Sudan" → ss and "Sudan" → sd;
  - "Nigeria" → ng and "Niger" → ne;
  - "Dominican Republic" → do;
  - "New Jersey" → us and "Jersey" → je;
  - "New Mexico" → us and "Mexico City" → mx;
  - "Indiana" → null, so "india" isn't matched inside it.
- **Exclusions:** "European Union" and "Unknown Region" → null.
- **`guessCountry`:**
  - "Lisbon" → pt (on the allowlist);
  - "Nairobi" → us (Kenya isn't on Indeed's list);
  - "Colombo" → us (unchanged).
- **`adzunaCountry`:**
  - "Nairobi" → null (skip);
  - "Lisbon" → null (skip);
  - "Kandy" → gb (unrecognised, unchanged).
- **Regression:** every assertion in the current `guessCountry`, `matchCountry`, `adzunaCountry` and `currencySymbol` tests passes unchanged.
- **Form:** there are no component tests in the repo (the tests are Vitest unit tests only), so the prefill and the hint are checked by hand. The page's `safeParse` and the 100-character guard are small inline expressions.

## Questions for you
1. **The hint text** under Location ("From your CV. Edit or clear it."): keep it (recommended), or prefill silently?
2. **Bare "Georgia":** map it to the country (recommended; the PRD documents it as a known ambiguity), or leave it unrecognised so it falls back to UK/US?
