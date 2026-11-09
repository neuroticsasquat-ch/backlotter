# backlotter: Undated Film Discovery — Project Spec (design of record)

- **Date:** 2026-08-10
- **Status:** Approved (design of record; supersedes the open questions in NEU-285)
- **Components:** `upcoming-movies-backend` (ingest, link, news, public) · `upcoming-movies-frontend` (film page, feed, search)
- **Linear:** project *backlotter: Undated Film Discovery*. Spike NEU-285 · pre-flight chore NEU-970
- **Base branch (both repos):** `release/v0.3.0`
- **Builds on:** [prerelease ingestion filter](2026-06-19-prerelease-ingestion-filter-design.md) ·
  [ingestion cadence](2026-06-20-ingestion-cadence-recency-architecture-design.md) ·
  [entity-linking candidate retrieval](2026-08-06-entity-linking-candidate-retrieval-design.md)
- **ADRs written with this spec:** backend `docs/adr/0013`, `0014`, `0015`; amends `0002`

## 1. What this is

Today a film enters the tracker only once it carries a **future release date**. TMDB's
`/discover/movie` enumerates by `primary_release_date`, and a date-range filter cannot match a
film that has no date — so just-announced and in-development projects are structurally
invisible. The prerelease spec accepted that boundary and named the gap **Path B**.

This project closes Path B: it discovers and admits films *before they have a release date*, and
it gives those films something to show once admitted.

### 1.1 Why it is worth doing, in one number

NEU-970 hand-classified 60 production-trade `no-match` stories. About **20% were production news
about films with no TMDB release date** — roughly **71/week**, against the **~41/week** currently
linked from those same outlets.

So the project has an unusually crisp thesis: **it exists to rescue ~71 stories/week that
currently die at `no-candidates`**, and the price is a candidate-retrieval set that collides
more. That is a measurable trade, and §7 states how it is measured.

### 1.2 What it is *not*

Story supply is **fixed**. Google News is paused (ADR-0001, `NEWS_GOOGLE_ENABLED` default
`false`), so the corpus is 8 curated trade feeds — a cost that does not scale with catalog size.
Admitting 5–20× more films brings in **no additional stories**. It only changes which stories
find a film to attach to, and how crowded the candidate set is when they try.

A direct consequence: **most newly-admitted undated films will have zero stories, forever.** The
trades write about the notable ones. Today only **117 of 1,435 films (8%)** have any linked
story at all. Admitting thousands more without doing anything else would make that ratio far
worse. That is why §5 (catalog-sourced events) is not an optional extra — it is the deliverable
that makes an admitted film worth having admitted.

## 2. Baseline measurements

Taken 2026-08-10 against the dev catalog (refreshed from prod).

| Measure | Value |
|---|---|
| `catalog.film` rows | 1,435 (**1** undated) |
| Films with ≥1 linked story | 117 (8%) |
| Films with ≥1 event | 123 |
| Status mix | In Production 652 · Post Production 639 · Planned 134 · Rumored 10 |
| Popularity p10 / p50 / p90 | 1.22 / 1.78 / 3.82 |
| `original_language = 'en'` | 557 (39%) |
| `catalog.person` | 26,844 |
| Distinct directors | 1,446 |
| Distinct writers (`Writer`/`Screenplay`) | 1,745 |
| Distinct top-5 billed cast | 5,299 |
| Distinct producers | 2,191 |
| Distinct production companies | 2,104 (144 with ≥3 films) |
| TMDB rate limit (configured) | 40 req / 10 s → ~4 req/s |

Two of these bound the design. The catalog **sits on the 1.0 discover popularity floor**
(p10 = 1.22), so undated films — which are far below it — cannot be reached or filtered by
popularity at all. And the catalog is **already 61% non-English with no language filter
anywhere in ingest**, which is why §4.3 declines to add one here.

## 3. Discovery: entity-scoped enumeration

### 3.1 Decision

Films are discovered by **walking the credits of people we already track**. The
`/movie/changes` feed is rejected outright — see [ADR-0013](../adr/0013-entity-scoped-enumeration-over-the-changes-feed.md).

The two facts that decide it:

- **`/movie/changes` returns `{id, adult}` and nothing else.** There is no pre-filter; every
  changed id costs a full `/movie/{id}` details fetch before it can be judged. Cost is
  proportional to *TMDB's* churn, which we do not control and which is overwhelmingly
  back-catalog metadata edits.
- **`/person/{id}/movie_credits` is one request and returns a whole filmography**, undated
  entries included. Cost is proportional to *our own* catalog, and the entities we track *are*
  the relevance prior.

### 3.2 The seed set

A **seed person** is anyone holding a seed-grade credit — **director**, **writer**
(`Writer`/`Screenplay`), or **top-5 billed cast** — on an active, non-dormant film.

| Seed grade | Distinct people |
|---|---|
| Directors | 1,446 |
| Writers | 1,745 |
| Top-5 billed cast | 5,299 |
| **Distinct union** | **7,519** (~31 min at 4 req/s) |

**Producers are excluded.** 2,191 more people whose attachment is the weakest of the four — an
EP credit travels far and says little about whether a project is real.

**Companies are excluded**, and rejected rather than deferred. There is no undated-only discover
filter, so company enumeration means paging a company's entire filmography with the date bounds
dropped, sorted by popularity, while the undated films we want sit at the bottom. For an indie
that is one page; for Universal it is 100+ pages of released back catalog. The cost concentrates
precisely on the majors, whose slate entries ("Untitled Event Film") are also the least
informative. Their projects are reached through their directors and stars anyway.

### 3.3 The seed set is self-expanding, and dormancy governs it

Admitting a film adds its credits to the catalog, so its director, writers and top-5 cast become
seed people on the next sweep — which finds more films, whose credits become seeds. 7,519 is
today's number, not a steady state, and sweep runtime is linear in it.

**Seeds derive only from active, non-dormant films** (§4.4). A film that turns out to be real
stays active and its people legitimately earn their place; a film that goes nowhere goes dormant,
its credits drop out of the seed query, and the sweep contracts. Cost tracks the size of the
*live* slate rather than the cumulative history of everything we ever looked at.

> **Named risk.** Dormancy is now load-bearing for **three** independent cost curves —
> the retrieval index, the per-film query list, and the seed set. If the tuned dormancy
> window comes back very large, all three grow together. The tuning ticket's acceptance
> criteria must check all three, not just retrieval.

### 3.4 Reflexivity, accepted

Entity tracking can only find films adjacent to what we already track. A debut director's first
project at a company we have never seen is invisible to it. Accepted as a v1 boundary, and a
better one than ingesting everything TMDB touched and hoping the relevance bar holds.

## 4. Admission, refresh, and dormancy

### 4.1 The admission bar

An undated film is admitted iff:

1. `status ∉ {Released, Canceled}` — reuse `ingest/tmdb/filters.py::classify_skip` unchanged; **and**
2. the seed person's role **on the candidate film** is itself seed-grade (director, writer, or
   top-5 billed). Without this, a "Special Thanks" credit drags in someone's short film; **and**
3. the film clears the **corroboration threshold** — the number of distinct seed-grade
   attachments required. **This constant is set from the probe, not guessed** (§4.3).

Popularity is not a lever here: undated films sit far below the 1.0 floor by definition.

### 4.2 The corroboration tension

One director attachment is the earliest and most valuable signal we can get. It is also what a
speculative TMDB entry looks like. Requiring ≥2 seed-grade attachments is a strong vaporware
filter that costs exactly the earliest signal the product sells. The threshold is therefore
config-driven and resolved by measurement, in the manner NEU-1001 resolved retrieval's T and K.

### 4.3 Probe-then-tune

The first ticket of M1 is a **read-only probe**: run the full 7,519-person sweep against live
TMDB, write nothing, and report the distribution of undated candidates by seed-attachment count,
status, original language, and seed role. A later tuning ticket sets the constants from that
table, exactly as the prerelease spec's popularity-floor table set the 1.0 floor.

Constants owned by the tuning ticket:

| Constant | Governs |
|---|---|
| Corroboration threshold | how many seed-grade attachments admit a film |
| Dormancy window **N** | how long quiescence lasts before dormancy |
| Dormant refresh cadence | how often a dormant film is still re-fetched |
| Retrieval **T** and **K** | the retune the expansion forces (§7.2) |

**No language or country bar.** The catalog is already 61% non-English with no filter; adding
one only for undated films would be incoherent policy. If we want a language bar it is a
separate decision applying to the whole roster.

#### Measured, 2026-08-11 — the corroboration threshold

The probe (`scripts/probe_undated_candidates.py`) was run against a prod snapshot taken minutes
before `SWEEP_ADMIT_DIRECTORS` was flipped, so this is the pre-expansion distribution and it
cannot be retaken. **7,180 seed people** (not 7,519 — the seed set moves with the catalog) →
4,540 distinct undated candidates → **3,250** after the status filter. 49 minutes, 0.5% of
person fetches failed. Rows: `docs/measurements/2026-08-11-undated-probe-pre-directors-flip.csv`.

**639 candidates (19.7%) were director-reached** — the population the first tranche admits.

| T | director-reached | Rumored | Planned | In Production | Post Production |
|---|---|---|---|---|---|
| ≥1 | **639** | 19.4% | 46.5% | 21.4% | 12.7% |
| ≥2 | 255 | **19.6%** | 39.2% | 24.7% | 16.5% |
| ≥3 | 87 | 13.8% | 32.2% | 28.7% | 25.3% |

**The threshold stays at 1**, and §4.2's tension resolves against the vaporware reading. Raising
it to 2 cuts the tranche by 60% while the `Rumored` share — the only available signature of a
speculative entry — does not move at all: 19.4% → 19.6%. Of the 384 films T=2 removes, 19.3% are
`Rumored`, indistinguishable from the base rate. It does not select against vaporware; it selects
against being early, which is the signal the product sells. The cost is explicit: **113 of those
384 (29.5%) are `In Production` or `Post Production`** — demonstrably real films discarded to
remove 74 `Rumored` ones. Only at T≥3 does the `Rumored` share fall, on a tranche of 87.

Two secondary results. Director-reached candidates are **better corroborated than the pool at
large** (39.9% carry ≥2 attachments vs 28.8% overall), so §7.4's ramp order opened the
highest-signal grade first. And **72% of all candidates are cast-only** against 6.7%
director-only — directors is the conservative step; the cast tranche is the one that moves the
numbers.

**Caveat.** Status is a *proxy* for "was it real", not the ground truth §4.3 asks for. The
dormancy-based figure — what fraction of admitted films subsequently went quiet — requires the
tranche to have been live for months. This settles the threshold provisionally; **N and the
dormant refresh cadence remain unmeasured.**

#### Measured, 2026-08-11 — the first post-flip sweep

The sweep run immediately after the flip reproduced the forecast exactly — 7,180 seeds, 4,540
candidates, 639 admitted, identical skip counts — which is the check that matters: the probe and
the sweep share `upmovies.ingest.sweep.seeds`, so the probe measures what the sweep applies.

| | Before | After | Δ |
|---|---|---|---|
| `catalog.film` | 1,620 | 2,259 | **+39.4%** |
| Distinct seed people | 7,180 | 7,666 | **+6.8%** |

Runtime **51m50s**, of which the first ~30 minutes commit nothing: enumerate fetches all seed
filmographies before judging a single candidate.

The seed-set row is §3.3's feedback loop with a number on it: 639 admitted films returned 486 new
seed people, and with `SWEEP_DORMANCY_DAYS` at its 365-day placeholder **nothing contracts the set
for a year**. Each sweep therefore starts from a larger seed set than the last, and the next run's
floor is 7,666 person requests. Sizing the task timeout down toward the observed 52 minutes would
be a mistake for that reason alone.

### 4.4 Dormancy

A dated film **ages out by itself** — it releases, `release_date < today`, and it leaves the
active set. An undated film **never does**: `release_date IS NULL` is permanently active, and
TMDB almost never flips a dead project to `Canceled`. Without a rule, every undated film we ever
admit stays in the retrieval index and draws a per-film query in perpetuity, and the working set
increases monotonically forever.

An undated film goes **dormant** when, for N days, TMDB has recorded no semantic change to it
(no `catalog.film_field_change` row — the trigger's denylist already strips popularity and vote
churn, so this is a true signal) **and** no story has linked to it. Any subsequent change or
linked story **revives** it automatically, because the predicate is derived rather than sticky.

Keyed on **quiescence**, not age: a film can be real and quiet for a year, and an age rule would
retire it wrongly.

Implemented in `catalog/queries.py::active_film_clause`, which gates **exactly two** consumers —
`link/retrieval/index.py` and `news/fetcher.py::_film_titles` — and **no public surface**. So
dormancy removes cost without removing content. See
[ADR-0015](../adr/0015-dormancy-governs-the-working-set.md).

**Films are never deleted.** The prerelease spec is explicit that status filtering "is not a
pruning mechanism"; dormancy is a working-set rule, not a retention one. A dormant film keeps its
page and its events. If we announced it, we do not un-announce it.

### 4.5 Refresh is scoped by reachability, not datedness

Two holes that a naive "refresh the undated films" rule leaves open:

**The promotion gap.** An admitted undated film has popularity below the 1.0 discover floor.
When it finally gets a release date it is no longer undated, so it leaves an undated-scoped
refresh — and it is still below the floor, and `_discover_candidate_ids` stops paging the moment
it hits a film below the floor, so discover never reaches it either. **Nothing would refresh
it.** Its metadata freezes at the moment it got a date, its status never advances, and no further
catalog-sourced events can ever fire for it.

**The dormancy deadlock.** Detecting the change that revives a dormant film *requires refreshing
it*. If dormancy also stopped the refresh it would be a one-way door with no handle on the other
side.

Therefore:

- The refresh phase covers **every active film that discover did not touch**, identified by
  `film.updated_at` predating the last `tmdb` run. (`upsert.py` sets
  `update_set["updated_at"] = func.now()` on every upsert, so this is reliable.) No popularity
  reasoning, no undated/dated branch, and it self-corrects if the discover floor moves.
- **Dormant films stay on a reduced-cadence refresh.** Dormancy stops the per-story costs — the
  retrieval index and per-film queries, where the money is — not the one request that keeps
  revival possible.

Honest cost: the refresh set never shrinks to zero, so the sweep's floor cost grows slowly and
permanently with everything ever admitted. Dormant means *quieter*, not *free*.

## 5. Catalog-sourced events

### 5.1 Why

ADR-0002 made TMDB the source of truth for release dates and demoted the story to "the trigger
and the colour". It did so on a premise **this project deletes**:

> **Every tracked film already has a release date.** … `film.release_date IS NULL` is effectively
> never true for a tracked film. Condition "no date yet" is a near-empty set; **"the date changed"
> is the whole game.**

After this expansion "no date yet" is the *majority* set. ADR-0002's unified null→date rule
survives intact, but the reasoning that justified *requiring a story trigger* does not. Combined
with §1.2 — most admitted films will never get a story — the conclusion is that catalog changes
must be able to create events on their own. See
[ADR-0014](../adr/0014-catalog-sourced-events.md).

### 5.2 Triggers

| Trigger | Infrastructure |
|---|---|
| A **displayable** release date set or moved | **new build** — `catalog.film_release_date` is delete-and-rebuild with no history |
| `status` Planned→In Production, etc. | **free** — `film_field_change` trigger records it; `status` is not in the denylist |
| Director / writer / cast attached | **new build** — `catalog.film_credit` is delete-and-rebuild with no history |

Two of the three need a change-history table analogous to `film_field_change`.

> **Corrected 2026-08-11 (NEU-1121).** This table used to read `release_date null→date, or
> moved | **free** — film_field_change trigger already records it`, and that one word was a
> defect. The trigger records `catalog.film.release_date`, TMDB's **primary** date: the
> earliest release in *any* country of *any* type, premiere and digital included. The film
> page lists **US-or-origin theatrical** dates only (§5.4), so the card routinely named a date
> the page never showed — on the first post-flip sweep, 21 of 56 release-date events were for
> films whose page displays no release date at all, and *Avengers: Secret Wars* carried a page
> reading "Wide, Dec 17 2027" beside a card reading "moved to 15 September 2027".
>
> The subject of a release-date event is now a displayable row, which needs its own history
> for exactly the reason credits do — the rebuild destroys the old side. `film.release_date`
> keeps one surface, the year parenthetical after the title, and raises no events at all.
> Details in `docs/specs/NEU-1121-release-date-events-match-the-page.md`.

### 5.3 First observation is a baseline, never an event

**A hard rule, stated here rather than left to fall out of an implementation detail.**

`film_field_change` is a `BEFORE UPDATE` trigger, so inserts produce no history — admitting 3,000
films fires zero status events. That protection is an *accident* of how that trigger happens
to be written, and accidents do not survive a rewrite. Both rewrites have now happened: the
credit history (NEU-1082) and the release-date history (NEU-1121) each earn the rule back
explicitly, keyed on a durable `*_observed_at` marker rather than on the rows being absent.

The credit-change history is being specified from scratch. Specified naively, the first time we
observe a newly-admitted film's credits, every director/writer/cast row looks like a brand-new
attachment: 3,000 films would produce tens of thousands of false "attached to direct" events on
day one — and it would be the first thing the expansion ever shipped to users.

So: **a film's credits are recorded on admission with no events emitted. Only subsequent diffs
produce attachment events.**

### 5.4 Presentation

`EventOut.summary` is a required `str` and every read path joins `EventSummary` — so **an event
with no summary row is invisible everywhere** (feed, film page, sitemap). A catalog-sourced event
must therefore write a real `EventSummary` row.

- **Deterministic body**, written by the event-creating stage rather than the summarizer
  ("Release date set to 14 Aug 2026", "Denis Villeneuve attached to direct"). No stories to
  summarize, and no opportunity to fabricate.
- **`model` is a sentinel** (e.g. `"deterministic"`), never a real model id, so the LLM cost
  tables are not polluted with rows that made no call. `prompt_version` carries the template
  version so wording changes stay traceable.
- **Attribution reads "via TMDB"** where outlets would show. An empty sources array with no
  explanation reads as a bug; unattributed text on a site whose credibility rests on sourcing is
  worse.
- **Confidence is marked below a trade-sourced beat.** TMDB is community-edited; a credit added
  by an anonymous editor is not a studio announcement.
- **Trade stories cluster onto it** as normal — the cluster stage's attach path already exists,
  and a catalog-sourced event is just another attach target. Once a story attaches, the LLM
  summary **supersedes** the deterministic one and real sources appear. The card upgrades in
  place, because `EventSummary` is keyed on the event.

Rejected: adding catalog events to `HIDDEN_EVENT_TYPES` and surfacing them only once a story
corroborates. Safer, but it leaves the pages empty and builds the machinery for nothing.

### 5.5 SEO is already handled

`get_sitemap_films` inner-joins `Event`→`EventSummary` under `visible_events()`, so a film with no
summarized event never enters the sitemap. Adding thousands of pages carries no thin-content risk
by construction — and catalog-sourced events, having summary rows, enter it legitimately.

## 6. Where the sweep runs

### 6.1 Placement

**Its own `ingest_run.kind` and its own Coolify schedule slot, roughly two hours before the daily
pipeline.** Not a stage in `run_daily`.

- `run_daily` is **fail-fast**: a TMDB hiccup during a ~45-minute sweep would abort feeds, link
  *and* synthesize for the day.
- The sweep's natural cadence is not obviously the pipeline's.
- A separate kind gives it its own row on `/admin/runs` instead of hiding inside the tmdb stage's
  counters.

`ingest_run.kind` carries a CHECK constraint (`'tmdb','feeds','link','synthesize'`); widening it
needs a migration.

Running ~2h ahead means newly admitted films are in the retrieval index for that day's link pass.

### 6.2 Two phases, both required

1. **Enumerate** — walk the seed people's credits, find undated films, admit those clearing the bar.
2. **Refresh** — re-fetch every active film discover did not touch (§4.5).

Phase 2 is not optional. Undated films are outside the discover window, so the `tmdb` stage never
touches them again after admission; no refetch means no upsert, no upsert means no
`film_field_change` row, and **the entire catalog-sourced-event feature silently produces
nothing** — the director attachment we built this to catch would never be seen.

### 6.3 Cost envelope

Assuming the probe finds ~3,000 admitted undated films:

| Phase | Requests | Time @ 4/s |
|---|---|---|
| Enumerate (7,519 people) | 7,519 | ~31 min |
| Refresh (~3,000 films) | ~3,000 | ~13 min |
| Admit new (details fetch) | probe-dependent | — |
| **Total** | ~10,500+ | **~45 min** |

Full sweep, daily, with a configurable throttle so it can be reduced to a rotating fraction if
TMDB pushes back. Rotating by default would add up to a week of latency to precisely the early
signal the product sells.

## 7. Acceptance, guardrails, reversibility

### 7.1 Accept on

Weekly linked stories from trade outlets rising materially from **~41/week** toward the
**~71/week** ceiling, **without** a drop in link-stage precision — measured by the same
hand-classified sampling method NEU-970 used.

**NEU-970 is a hard blocker on the sweep going live**, not a parallel chore: it collects the
pre-expansion baseline, and without it the post-expansion comparison has nothing to compare
against. Its three numbers to re-measure are 67.7% of (film, day) pairs carrying exactly one
linked story; 164 of 199 events spanning zero days; ~1 user-visible clustering defect in six
weeks.

### 7.2 Guard on

`link/retrieval/health.py`'s existing two-tier guard (ADR-0010). Cap saturation at K=25 is 0.1%
today and the candidate-retrieval spec already names it "the number to watch as the undated-film
expansion lands", projecting **p90 ~45 candidates at 5×** and **~180 at 20×** — K=25 saturates.
**The T/K retune is a ticket in this project**, not a follow-on.

### 7.3 Reversibility

The sweep sits behind its own flag, in the manner of `NEWS_GOOGLE_ENABLED`. If precision
collapses we turn it off; dormancy then drains the working set naturally, without deleting
anything.

### 7.4 Ramp

Admission ramps by seed grade — **directors → writers → top-5 cast** — one ticket per tranche.
The retrieval-health guard gets to react to a 1,446-person expansion before a 7,519-person one;
the T/K retune gets real intermediate data instead of one cliff; and if precision collapses we
learn *which* seed grade caused it rather than staring at one undifferentiated jump.

## 8. Frontend

Public routes are exactly **feed (home), calendar, film, privacy, terms**. There is no browse
index; search is a box component. Surface area touched: **film page, feed, search results**. The
calendar is untouched — undated films have no dates to place.

- Where the year renders (`FilmHeader.tsx:33`, `SearchResultItem.tsx:28`, `FeedDayCard.tsx:14`)
  an undated film shows its **arc-stage label** — "Announced". `ARC_STAGE_LABELS` already exists
  in `labels.ts` and the backend already derives `announced` from `Planned`/`Rumored`. More
  informative than "TBA", and no new vocabulary.
- **Catalog-sourced event cards** render "via TMDB" in place of outlets (§5.4).
- **Search ordering unchanged.** `nulls_last(Film.release_date.desc())` appears to bury undated
  films, but the primary-title-match `case()` sorts *ahead* of it, so an exact title search still
  returns them first. The burying only affects partial matches, where a dated film is the better
  guess.
- **No new route.** The feed *is* the discovery surface, and it will populate with these films
  once catalog events land. An "In development" browse page is the natural follow-on project.

## 9. Out of v1

| Excluded | Why |
|---|---|
| TMDB `/movie/changes` feed | Rejected — ADR-0013 |
| Company-seeded enumeration | Rejected — §3.2 paging economics |
| Language / country bar | Whole-roster decision, not this project's — §4.3 |
| Un-pausing Google News / per-film queries | ADR-0001's trial stands |
| Region-aware release-date events | Already deferred by ADR-0002 (no history on `film_release_date`) |
| "In development" browse surface | Follow-on — §8 |
| Pruning or deleting films | Standing policy |
| Re-opening the clustering project | NEU-970's re-measurement decides it (ADR-0004) |
