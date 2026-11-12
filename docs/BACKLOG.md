# Evidence Desk — feature backlog

From *Functions worth adding: detailed specifications*, the companion to the code review,
11 November 2026. Kept here so a future build can start from the specification rather than
from the document.

**Status is recorded against what is actually in the repository**, not against what was
planned. Where a feature was partly delivered by the code review work (phases 1 and 2), the
entry says which part and what is left.

| ID | Feature | Value | Effort | Status |
| --- | --- | --- | --- | --- |
| N1 | True evidence map | Very high | Medium | Partly built (B1, B2); gaps listed below |
| N2 | Why this label | High | Low | Partly built (A6); gaps listed below |
| N3 | Citation chasing in both directions | High | Low | Not started |
| N4 | Screening mode | High | Medium | Not started |
| N5 | Integrity recheck | High | Low | Not started |
| N6 | Timeline view | Medium | Medium | Not started |
| N7 | Trial and paper links | High | Medium | Not started |
| N8 | Best synthesis pinned | High | Low | Not started |
| N9 | Guideline link out | Medium | Low | Not started |
| N10 | PICO question builder | Medium | Medium | Not started |
| N11 | Saved search alerts | Medium | Medium | Not started |
| N12 | Shareable read only collections | Medium | Low | Not started |
| N13 | Installable app and offline reading list | Medium | Low | Not started |
| N14 | Keyboard shortcuts | Low | Low | Not started |
| N15 | Compare two questions | Low | Medium | Not started |
| N16 | Free full text through Unpaywall | Medium | Low | Not started |
| N17 | Preprint and published version merged | Low | Low | Not started |
| N18 | Richer evidence table | Medium | Low | Not started |
| N19 | Small study marker | Medium | Low | Not started |

Build order from the specification: **N1, N2** first; then **N3, N5, N8, N19**; then
**N4, N7, N16, N18**; the rest by what people ask for.

---

## N1 True evidence map — partly built

Each grid cell shows how many papers Europe PMC has indexed with that design in that era,
and the cards are sampled from every non-empty cell rather than being page one by relevance.

Delivered by commits `d222cc4` (B1) and `2140ce1` (B2):

- One request per cell, `pageSize=3&sort=CITED desc&resultType=core`, which returns the
  count in `hitCount` and the sample in the same round trip: 18 requests a search, not 36.
- Concurrency capped at 6. Fired after the results render, so nothing waits on them.
- Counts and dots are drawn as separate layers and never added together. Rows with no
  corresponding publication type (preclinical) get no number rather than a guess.
- A partial set is discarded rather than drawn, because a missing cell reads as a zero.
- Sampled papers are ordered best-of-every-cell in ladder order, then second-best of every
  cell. Sorting the whole sample by citations hands the top of the list to the Review row.
- Cells are clickable.

Still to do: carry the chosen cell in the URL so it is shareable; cache the counts in
`sessionStorage` keyed by query; mark the sampled cards as coming from the map; and say in
a tooltip that publication types lag, so the newest era undercounts.

**Known limit, proven not fixable here.** The specification's test was that DAPA-HF and
EMPEROR-Reduced appear for "SGLT2 inhibitors heart failure mortality". They cannot: neither
paper contains the word *mortality*, both say *death*, and Europe PMC ANDs the query terms,
so both are excluded before any ordering or sampling runs. Verified by querying each record
against each term individually. This needs query expansion, which is not part of N1. The
other half of the test passes: the 2011-2021 trial cell shows 249.

## N2 Why this label — partly built

The sheet says where a design label came from: the indexed publication type, or the exact
phrase that triggered an inferred label, highlighted in the abstract.

Delivered by `6ebd01b` (A6) and `66fb820` (A6, quote the phrase that produced the label):
`classify()` returns `because` and the sheet names it.

Still to do: `classifyPsy()` returns no `because` at all, so every psychology label is
unexplained; the phrase is not highlighted in the abstract; and a stored paper saved before
this existed needs treating as unknown rather than blank.

## N3 Citation chasing in both directions — not started

Alongside "Cited by", a "Cites" view showing the paper's reference list, classified and
placed on the same grid.

`GET /{source}/{id}/references?format=json&pageSize=100`, then batch the identifiers back
through the search endpoint (`EXT_ID:a OR EXT_ID:b ...`) in groups of about 50, so the
references arrive as full records with publication types and can be classified. Reuse the
"Cited by" results view and grid. For psychology, OpenAlex lists `referenced_works`.
References with no identifier should be reported as a count, not silently dropped.
Done when: Wakefield 1998 shows "Cites (26)" and the references appear on a grid.

---

## N4 Screening mode — not started

Open a collection one paper at a time with Include / Exclude (with a reason) / Maybe,
keyboard shortcuts, and a running PRISMA-shaped count.

- Decision per paper per collection: `include`, `exclude`, `maybe`, plus an optional reason
  from a fixed list (wrong population, wrong intervention, wrong design, not human,
  duplicate, other).
- Signed out: `localStorage` beside the reading list. Signed in: a Supabase table with the
  same row level security pattern already in use.

```sql
create table public.screening (
  user_id uuid references auth.users not null default auth.uid(),
  collection text not null, paper_id text not null,
  decision text check (decision in ('include','exclude','maybe')),
  reason text, decided_at timestamptz default now(),
  primary key (user_id, collection, paper_id));
alter table public.screening enable row level security;
create policy "own rows" on public.screening for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- Keys: `i` include, `e` exclude then 1-6 for the reason, `m` maybe, `u` undo, arrows move.
- Header counter: "Screened 84 of 212 · Included 19 · Excluded 58 · Maybe 7".
- Export decisions as CSV and a PRISMA-style count table. Optional second reviewer: import
  a colleague's CSV and show disagreements.
- Watch out: shortcuts must not fire while typing in a note; decisions must be undoable;
  be explicit that this is title and abstract screening only, not full text or risk of bias.
- Done when: a 50 paper collection can be screened by keyboard alone, and reopening on
  another device continues where it stopped.

## N5 Integrity recheck — not started

Recheck saved DOIs against Crossref, which carries the Retraction Watch database, whenever
a collection is opened or exported.

```js
const r = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}?mailto=CONTACT_EMAIL`);
const m = (await r.json()).message;
const ups = m["updated-by"] || [];
const retracted = ups.some(u => u.type === "retraction");
const concern   = ups.some(u => u.type === "expression_of_concern");
```

- Saved papers only, concurrency about 4, cached a day in `sessionStorage`, `lastChecked`
  per paper. Credit Retraction Watch on the Ranking page.
- Banner: "1 paper in this collection has been retracted since you saved it."
- Watch out: check the exact `expression_of_concern` type string against a real record
  before relying on it; papers with no DOI cannot be checked, and the interface must say so.
- Done when: adding Wakefield 1998 and exporting shows it in red with its source named.

## N6 Timeline view — not started

A toggle replacing the three era columns with a continuous year axis; rows stay designs.

- Per-year per-tier counts for a background bar, dots for the listed papers on top.
- Refactor `plotSvg()` so layout is separate from drawing. Remember the choice.
- Watch out: on a phone, allow horizontal scroll rather than squashing.
- Done when: the CMT1A ascorbic acid question shows trials around 2009-2014 followed by
  later syntheses.

## N7 Trial and paper links — not started

- Paper to trial: `GET https://clinicaltrials.gov/api/v2/studies/{NCT}`, show status,
  enrolment, registered primary outcome, whether results were posted.
- Trial to paper: search Europe PMC for the NCT number.
- Sheet line: "Registered as NCT01234567 · Completed · 4,744 enrolled · Results posted".
- Flag wording must never accuse: "No results posted and no linked publication found",
  never "unpublished". Results may be in a journal without being posted, and the duty to
  post mainly covers certain US trials.
- Fetch only when a sheet opens, never for every result.
- Done when: DAPA-HF's paper shows its registry record, and NCT03036124 lists its NEJM paper.

## N8 Best synthesis pinned — not started

Pin the most recent Cochrane review and the most recent other meta-analysis for the query.

- Two small extra queries per search. Confirm the exact `JOURNAL` or ISSN value Europe PMC
  uses for the Cochrane Database of Systematic Reviews first.
- Slim "Start here" panel, each card showing the year and its age. Hide when empty.
- If the newest synthesis is over five years old: "The latest synthesis predates N newer
  trials", using the N1 counts.
- Done when: the statin primary prevention query pins a Cochrane review.

## N9 Guideline link out — not started

A Guidelines menu opening the same question in NICE and similar, plus the Europe PMC
guideline filter. No API: build search URLs, confirm each site's URL format first. Keep the
list short and UK focused unless a region setting is added. Explain on the Ranking page why
guidelines are linked rather than counted.

## N10 PICO question builder — not started

Four optional boxes assembling a visible, editable Europe PMC query. OR within a box, AND
between boxes, quote multi-word phrases. PICO parts go in the URL so built searches stay
shareable. The plain search box stays the default. Synonyms last.

## N11 Saved search alerts — not started

`saved_searches (user_id, query, filters, last_run, last_seen_ids)` with the same row level
security pattern; a Supabase Edge Function run weekly by `pg_cron` queries Europe PMC with a
date filter since `last_run`; email through a transactional provider with the key as a
Supabase secret. Adds personal data and a scheduled job, so the privacy page must change.
Rate limit per user. Unsubscribe links.

## N12 Shareable read only collections — not started

A collections table (or a public flag) with a random slug, and a policy allowing anonymous
`select` only where `public` is true. Share toggle with "include my notes" as a **separate**
choice; notes are never shared by default. Read only page with a "Make your own copy"
banner. Done when a logged out browser sees the collection and its grid and nothing else.

## N13 Installable app and offline reading list — not started

`manifest.json` (name, icons, theme colour, `display: standalone`) and a small service
worker caching the static files cache-first, never caching API responses. Bump the cache
version on every deploy. Test Add to Home Screen on iPhone and Android. Delivers most of
the benefit of the deferred native app, and tests whether anyone wants it.

## N14 Keyboard shortcuts — not started

`/` focuses search, `j`/`k` move between cards, Enter opens, `s` saves, `o` opens full
text, `?` shows the list. One keydown listener that ignores events from inputs and
textareas. Visible focus ring. Check it does not clash with screen reader keys.

## N15 Compare two questions — not started

Two queries, two grids, shared colour scale, `q` and `q2` in the URL. Split on desktop,
stacked on a phone. Show both queries clearly, since wording changes counts. Needs N1.

## N16 Free full text through Unpaywall — not started

`GET https://api.unpaywall.org/v2/{doi}?email=CONTACT_EMAIL`, read `best_oa_location`
(url, version, host type). An email parameter is required instead of a key. Call only when
a sheet opens, and check from the browser first that cross origin calls are allowed; if
they are blocked, drop the feature rather than adding a proxy just for it. Label the
version: "Free full text (accepted manuscript, university repository)".

## N17 Preprint and published version merged — not started

Read the preprint-to-published link in the Europe PMC record and collapse the pair, keeping
the journal version's metadata and both identifiers. Only merge on an explicit link, never
by title similarity. Note: testing during phase 2 found a bioRxiv paper reaching the reading
list as a `PMC:` record with no authors and no preprint flag, which this feature should
also cover.

## N18 Richer evidence table — not started

Add year, country, funding, registration number, sample size and optional user-filled PICO
columns to the evidence table export. Most fields are already collected. Label country
"first author country", since it is approximate. Column chooser on export.

## N19 Small study marker — not started

Primary studies with a detected sample size under a threshold (say 50) are drawn as hollow
dots, with a legend entry. Uses the existing `findN()`, for primary studies only, never for
syntheses. Unknown `n` must not look small. Done when Wakefield 1998 (n = 12) is hollow.

Note from phase 2: `findN()` currently reads 494 from a study of 1,407 by picking a
subgroup `(n=494)`, so its confidence needs tightening before it drives a visual marker.

---

## Deliberately not adding

- **AI summaries.** The one feature that could be confidently wrong about a treatment.
  "Nothing on this site is generated" is worth saying on the home page.
- **A single quality score or star rating.** Design, size and integrity flags can be shown;
  an overall score would claim a judgement the metadata cannot support.
- **Scraping paywalled databases.** Stay with sources that allow it: Europe PMC, OpenAlex,
  ClinicalTrials.gov, Crossref, Unpaywall.

## Sources

- Live testing of Evidence Desk and direct calls to Europe PMC (search, citations and
  references endpoints), OpenAlex and ClinicalTrials.gov, 11 November 2026.
- Crossref on Retraction Watch data in the REST API:
  crossref.org/documentation/retrieve-metadata/retraction-watch
- Unpaywall REST API v2: unpaywall.org/api/v2
- Europe PMC RESTful Web Service: europepmc.org/RestfulWebService
- ClinicalTrials.gov API v2: clinicaltrials.gov/data-api/api
