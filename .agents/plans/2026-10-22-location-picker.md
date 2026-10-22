# Plan: Country and city picker for the search Location

**Status**: Completed (code), 2026-10-22. Review approved with "fix all": `.agents/plans/reviews/2026-10-22-location-picker-review.md`. Manual browser check pending.
**Date**: 2026-10-22
**Type**: Small feature (UI plus static data). Not an Asana task. No PRD (a single task).
**Branch**: `feature/location-picker`, from `origin/master` at `1edd552` (includes #38 View PDF).
- Local `master` has diverged from `origin/master`: it has old local merge commits. It was left untouched; work starts from `origin/master`.

## Task Summary
Today, **Location** on the search page is a free-text box. While typing, it calls `/api/location-suggest`, which asks Photon (a free OpenStreetMap service) for 5 matches, shown as raw labels like "Colombo, Western Province, Sri Lanka · CITY".

**Replace it with two clear, searchable dropdowns:**
1. **Country:** every country, A–Z, with its flag. Type to filter.
2. **City (optional):**
   - "Anywhere in {country}" first, then that country's main cities. Type to filter.
   - If the place isn't listed, "Use "{typed text}"" lets you use any town.

**The value sent to the search** is unchanged in shape. It's still one `location` string:
- "Colombo, Sri Lanka" for a city;
- "Sri Lanka" for "Anywhere".

So the search API, the job sources and the database don't change.

**Decided with you (2026-10-22):**
- the layout is **country, then city**;
- city data is a **built-in list** (no live lookup).

## Affected Files
- **`lib/locations/cities.json`** (new, generated):
  - `{ [countryCode]: string[] }`, the main cities per country, biggest first;
  - from GeoNames `cities15000` (CC BY 4.0), with up to 25 per country;
  - about 4–5k names, about 60 KB raw (about 20 KB gzipped).
- **`scripts/build-cities.ts`** (new):
  - downloads `cities15000.zip`, keeps the largest N per country, and writes the JSON;
  - drops any city whose "City, Country" label `matchCountry` would read as a **different** country (see Risks);
  - it's run by hand and the output is committed. It's not a build step.
- **`lib/locations/index.ts`** (new, pure, shared by client and tests):
  - `listCountries()`: `{ code, name }[]` A–Z. Names come from `Intl.DisplayNames`, the same source and exclusions as `matchCountry`.
  - `citiesFor(code)`: the city list for a country.
  - `toLocation(country, city?)` → "City, Country" / "Country".
  - `fromLocation(text)` → `{ countryCode, city? }`, for the CV prefill.
  - `filterOptions(list, query)`: accent- and case-insensitive contains.
- **`lib/job-sources/country.ts`:**
  - export the country list it already builds (codes plus English names, minus `NOT_COUNTRIES`), so the picker and `matchCountry` can't drift;
  - export `normalize`;
  - no change to matching behaviour.
- **`components/location-picker.tsx`** (new): the two comboboxes, built on `@base-ui/react/combobox` (already installed, 1.4.0), styled like the current input and listbox.
- **`components/search-form.tsx`:**
  - the Location input and its Photon suggestion code are replaced by `<LocationPicker>`, wired to the same `location` form field with `setValue`;
  - the "From your CV" hint and the Remote-only disabling stay.
- **`app/api/location-suggest/route.ts`:** no longer used by the form. See Question 2.
- **Tests:** `tests/unit/locations.test.ts` (new).
- **Docs:**
  - this plan and its review;
  - the GeoNames attribution line in `README.md`;
  - possibly a line on `/help` (see Question 3).

## Current Behavior to Preserve (`SearchForm`)
1. **Form fields and submit:** `query`, `location`, `remoteOnly`, `sources`, `maxResults`; the zod schema; and the POST to `/api/search`, with the same body shape.
2. **CV prefill:**
   - `defaultLocation` (the active CV's location) prefills the field, and "From your CV. Edit or clear it." shows while it's unchanged.
   - With the picker, the CV text is mapped to country + city. When the city isn't in the list, it's kept as a custom city.
   - When the CV location can't be mapped to a country, the field starts empty, with no hint.
3. **Remote only:** the Location controls are disabled, and the location is ignored as today.
4. **Empty location is allowed:** no country chosen means "no location", as today.
5. **Everything else in the form is unchanged:** the source toggles, max results, the blank-query CV hint, and the loading state.

**Server side is unchanged:**
- `/api/search` (`location: z.string().max(100).optional()`);
- `run-search`;
- the job sources;
- `matchCountry` and `guessCountry`, apart from the two exports;
- the search history display.

## Out of Scope
- **Choosing several locations at once.**
- **States and regions** as a level ("California", "Western Province").
- **Changing how job sources read the location**, for example passing the country code through the API.
- **Live geocoding** for towns that aren't listed. The "Use "…"" free-text option covers them.
- **Editing the CV's location.**

## Approach
1. **City data.**
   - Write `scripts/build-cities.ts`, run it once (asking you first, since it downloads GeoNames, about 2 MB), and commit `cities.json`.
   - It keeps cities with population ≥ 15k, the top 25 per country by population.
   - It uses the GeoNames `name` (UTF-8, e.g. "São Paulo") and drops duplicates within a country.
2. **`lib/locations`:** the pure helpers above, unit-tested.
   - `fromLocation` takes the country from `matchCountry`. The city is the first comma part, if it isn't the country itself.
3. **`LocationPicker`:**
   - **Country combobox:**
     - flag and name; type to filter (contains, accent-insensitive); keyboard support from base-ui;
     - a clear (×) button resets both fields to "no location".
   - **City combobox:**
     - disabled until a country is chosen;
     - the options are "Anywhere in {country}", then the cities, then "Use "{typed}"" when the typed text isn't an exact match;
     - changing the country resets the city to "Anywhere".
   - **Output:** `onChange(toLocation(country, city))`, so the form keeps a single string.
4. **`SearchForm`:**
   - swap the input for the picker;
   - remove the Photon fetch, the debounce and suggestion state, the keyboard handler and the blur timer (now unused);
   - the hint shows while the picked value equals the prefilled one.
5. **Checks:** lint, typecheck, `npm test` and `next build`, after asking.

## Database Changes
None.

## API Endpoints
None changed. `GET /api/location-suggest` becomes unused (Question 2).

## Edge Cases & Risks
- **City names that the job sources read as another country.** `matchCountry` checks city and alias patterns before country names, so "Lagos, Portugal" would be read as Nigeria (`/lagos/`).
  - The build script **drops** such cities.
  - A unit test checks every listed "City, Country" round-trips to its own country, and every country name round-trips to its code.
  - `matchCountry` itself isn't changed.
- **Flags on Windows:** Windows doesn't draw flag emoji. It shows the letters "LK" instead. See Question 1.
- **Bundle size:** about 20 KB gzipped of city data in the search page's client bundle. That's acceptable. It can be lazy-loaded on first open if needed.
- **CV locations the list doesn't know** (a small town): kept as a custom city under the matched country, so the search uses the same text as before.
- **Old searches** keep their stored free-text location. Nothing is migrated.
- **Countries with few or no listed cities** (tiny territories): only "Anywhere in …" plus "Use "…"".
- **Licence:** GeoNames is CC BY 4.0, which needs attribution. It's added to the README and as a comment in the JSON header.

## Testing Strategy
**Unit** (`tests/unit/locations.test.ts`):
- **`listCountries`:** sorted A–Z; includes Sri Lanka, United Kingdom, United States; excludes `NOT_COUNTRIES` (e.g. EU, UN).
- **Round trip:** for every country, `matchCountry(name) === code`. For every city in `cities.json`, `matchCountry("City, Country") === code`.
- **`toLocation`:**
  - `("lk", "Colombo")` → "Colombo, Sri Lanka";
  - `("lk")` → "Sri Lanka";
  - no country → "".
- **`fromLocation`:**
  - "Colombo, Sri Lanka" → `{ lk, Colombo }`;
  - "London, UK" → `{ gb, London }`;
  - "Sri Lanka" → `{ lk }`;
  - "Negombo, Sri Lanka" → `{ lk, Negombo }` (custom);
  - "Atlantis" → no country.
- **`filterOptions`:** "sao" matches "São Paulo"; it's case-insensitive.

**Regression:** the full `npm test`, `typecheck`, `lint` and `next build`.

**Manual:**
- pick a country and then a city;
- "Anywhere in …";
- a custom town;
- clear the country;
- Remote only disables the picker;
- the CV prefill and its hint;
- keyboard only (arrows, Enter, Esc);
- a search runs with the chosen location.

## Questions for you
1. **Flags:** Windows can't draw flag emoji, so it shows "LK" instead of 🇱🇰.
   - **a (recommended):** emoji flags plus `country-flag-emoji-polyfill`. It's tiny and MIT. It loads a flags-only font **from the jsDelivr CDN**, only on browsers that need it. One new dependency and one outside request on Windows.
   - **b:** no flags; show the country code in a small grey chip ("LK"). Nothing new.
   - **c:** bundled SVG flags (`country-flag-icons`). Crisp everywhere, but adds about 100–300 KB unless lazy-loaded.
2. **The old `/api/location-suggest` route (Photon):** delete it in this change, since nothing would use it (recommended), or keep it for now?
3. **Help line:** add a bullet to `/help`, e.g. "Pick a country, then a city, or type any town"? Recommended: skip; the dropdowns are self-explanatory.

## Outcome (2026-10-22)
- **Answers** (approved with "ok"):
  - Q1: emoji flags + `country-flag-emoji-polyfill`;
  - Q2: `/api/location-suggest` deleted;
  - Q3: no help line.
- **Data:** `lib/locations/cities.json` has 3,830 cities for 242 countries (45 KB, about 23 KB gzipped).
  - NYC boroughs are skipped explicitly in the build script.
  - 15 cities are dropped because their label reads as another country.
- **Deviations:**
  - **Matcher exports:** `country.ts` exports `intlCountryNames()` (the extracted Intl loop) as well as `normalize`. `getCountryNames` builds identical patterns from it.
  - **Two Congos:** the picker adds them back ("DR Congo", "Congo"), since `matchCountry` excludes them from its name list.
  - **Three territories** aren't pickable (`bq`, `um`, `vi`), because `matchCountry` reads their names as nl/us.
  - **Attribution** is in `README.md` and the `lib/locations/index.ts` header, not in the JSON (JSON can't hold comments).
  - **Hidden inputs:** `itemToStringValue` set, so base-ui's hidden inputs hold plain values.
- **Review "fix all":**
  - **Town-only CV locations:** `fromLocation` infers the country for a town given alone when exactly one country lists it ("Kandy" → Sri Lanka; "Hamilton" stays ambiguous), and keeps a listed city given alone ("London").
  - **Length cap:** custom towns are capped at `MAX_CITY_LENGTH` (60), in `toLocation` and as the city input's `maxLength`.
  - **Filters:** per-item matchers `matchesCountry` / `matchesCity` are used by the picker.
- **Left as follow-ups:**
  - component tests for the picker (no jsdom setup in the repo);
  - the `matchCountry` quirks (Port of Spain, Porto-Novo and others; the three territories).
- **Checks:**
  - `npm run lint`: 0 errors, 1 existing warning;
  - `npm run typecheck`: clean;
  - `npm test`: 30 files, 360 tests passed;
  - `next build`: OK.
- **Still open:** the manual browser check (see Testing Strategy, Manual).
