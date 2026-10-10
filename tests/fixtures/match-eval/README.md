# Match-quality evaluation fixtures

Synthetic CVs and jobs used by `npm run eval:matching` (`tests/eval/`) to measure
how well the ranking pipeline (`lib/match-pipeline.ts`) puts the right jobs on
top. Everything here is invented: the people, companies, emails and links are
fictional. See `.agents/prd/PRD-match-quality.md`.

Each job is **designed** to be good, ok, bad, ineligible or stale for its CV, so
its label is known up front. The owner reviews the labels; they are the ground
truth.

## Layout
One folder per case, `tests/fixtures/match-eval/<case>/`:

| File | Contents |
|---|---|
| `cv.txt` | Plain-text CV, 2,500–5,000 characters, like text extracted from a PDF |
| `profile.json` | The structured CV, as the app stores it (`CvStructuredSchema`) |
| `search.json` | `{ "queries": string[3], "location": string \| null, "remoteOnly": boolean, "maxResults": 10 }` |
| `jobs.json` | Array of exactly 48 jobs (format below) |
| `labels.json` | `{ "<sourceJobId>": { "label", "trap"?, "why" } }`, one entry per job |

### `profile.json`
```json
{
  "name": "string",
  "email": "string",
  "location": "City, Country",
  "summary": "string",
  "skills": ["string"],
  "experience": [{ "role": "string", "company": "string", "period": "string", "description": "string" }],
  "education": [{ "degree": "string", "institution": "string", "year": "string" }]
}
```
Consistent with `cv.txt`. Most recent role first.

### `search.json`
`queries` are what the app would derive from the CV: 3 complementary job-search
queries, 2–5 words each, in the profession's own job-title vocabulary (for
example `["ICU Staff Nurse", "Critical Care Registered Nurse", "Band 6 Nurse"]`).
`location` is the search location the candidate would type.

### `jobs.json`
```json
{
  "source": "remotive" | "adzuna" | "jsearch",
  "sourceJobId": "<case>-01" … "<case>-48",
  "title": "string",
  "company": "string (fictional)",
  "location": "string | null",
  "remote": true | false,
  "salary": "string | null",
  "postedDaysAgo": "integer | null",
  "description": "string | null",
  "applyUrl": "https://jobs.example.com/<case>/<NN>"
}
```
`postedDaysAgo` replaces `postedAt` so freshness never goes stale; the loader
turns it into a date at run time.

### `labels.json`
```json
{ "<case>-07": { "label": "good", "trap": "late-requirements", "why": "One sentence." } }
```

## Labels (rubric)
| Label | Meaning | nDCG gain |
|---|---|---|
| `good` | A job this candidate should apply to: same field and role type, meets the hard requirements, seniority fits, eligible by location, fresh | 3 |
| `ok` | Plausible but not ideal: adjacent role, or one soft gap (a nice-to-have skill, a slightly different specialism, a small seniority step) | 1 |
| `bad` | Wrong field, seniority two or more levels off, or a missing **hard** requirement (licence, registration, certification, degree, required language) | 0 |
| `ineligible` | Would be good or ok, but the candidate can't take it: remote limited to regions that exclude them, on-site in another country, or a work authorisation they don't have | 0 |
| `stale` | Would be good, but posted 45–90 days ago | 0 |

## Required mix per case (exactly 48 jobs)
- **10 good**
  - 3 with `trap: "late-requirements"`: the description opens with 600+ characters of company intro, mission and benefits before any requirement.
  - 2 with `trap: "synonym-title"`: a genuinely matching job whose title shares **no** word with any of the 3 queries, ignoring generic words like developer, engineer, senior, junior, lead, manager, remote.
- **8 ok**
- **18 bad**, using these traps:
  - at least 4 `different-field`;
  - at least 4 `seniority`;
  - at least 4 `missing-hard-requirement`;
  - exactly 4 `keyword-stuffed`: the title contains query words, but the job is the wrong field or level. For example "Laravel Developer Intern (unpaid)" for a mid-level developer, or "Nurse Recruiter (Sales)" for a nurse.
- **8 ineligible**, mixing `region-restricted-remote`, `onsite-other-country` and `work-authorisation`. The restriction must be stated explicitly in `location` or `description`, for example "Remote, US residents only" or "Must hold the right to work in the UK; no sponsorship".
- **4 stale**, with `trap: "stale"`: otherwise good, with `postedDaysAgo` between 45 and 90.

## Writing rules
- **Shuffle the order.** Labels must not be grouped, and the first 10 jobs must not be the good ones. Ids run 01–48 in file order.
- `postedDaysAgo`: 0–20 for non-stale jobs, with up to 5 of them `null`. Never `null` for stale jobs.
- **Descriptions:**
  - 300–2,500 characters, with varied lengths.
  - About 10 jobs use light HTML (`<p>`, `<ul><li>`, `<br>`, `<strong>`), and a few have messy real-world formatting.
  - Never hint at the label ("perfect for you", "great match").
- **Sources:**
  - `remotive` jobs are remote, with locations like "Worldwide", "USA Only", "Europe Only", "UK Only" or "Americas".
  - `adzuna` and `jsearch` jobs are usually on-site or hybrid, with a city location; a few are remote.
- **Salary:** in the local currency on about half of the jobs.
- **Realism:** companies are fictional but realistic. No real company names, people or URLs except `jobs.example.com`. CV emails use `@example.com`, and phone numbers use `+00 000 000 000`.

## Cases
| Case | Candidate | Search location | Remote only |
|---|---|---|---|
| `software-lk` | Mid-level PHP/Laravel backend developer, 4 years (Laravel, MySQL, REST APIs, Vue basics, AWS basics) | Colombo, Sri Lanka | no |
| `nurse-gb` | Registered nurse with an NMC PIN, ICU / critical care, 6 years, Band 5 → 6 | Manchester, UK | no |
| `accountant-ae` | ACCA-qualified accountant, 4 years audit (mid-tier firm) then 4 years financial reporting (IFRS), English and basic Arabic | Dubai, UAE | no |
| `sales-us` | B2B SaaS account executive, 5 years, mid-market, consistently over quota, Salesforce | Chicago, USA | no |
| `teacher-au` | Primary school teacher, 3 years, VIT registered, Working with Children Check, literacy focus | Melbourne, Australia | no |
| `hospitality-sg` | Hotel front office manager, 10 years in 4–5 star hotels, Opera PMS, team of 15 | Singapore | no |
| `logistics-ca` | Warehouse supervisor, 7 years, forklift certified, WHMIS, WMS (Manhattan), team of 20, shift work | Toronto, Canada | no |
| `designer-pt` | UX/UI designer, 4 years, Figma, design systems, user research, Portuguese and English, EU citizen | Lisbon, Portugal | **yes**: on-site or hybrid roles in Lisbon are at best `ok`, and those elsewhere are `ineligible` |

## Owner label changes
- 2026-10-09: `nurse-gb-11` (on-site ICU job in Dublin) changed from `ineligible` to `ok`. UK citizens can work in Ireland under the Common Travel Area, so this is a relocation, not an eligibility barrier. `nurse-gb` therefore has 9 ok and 7 ineligible jobs.

## Adding a case
Follow the layout and mix above. The integrity test
(`tests/unit/match-eval-fixtures.test.ts`) checks the counts, the ids and the labels.
