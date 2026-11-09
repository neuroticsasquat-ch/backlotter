# M5 — Comprehensive film page (milestone design)

- **Project / milestone:** Movies: MVP Launch Polish · **M5 — Comprehensive film page**
- **Date:** 2026-06-25
- **Repos:** `upcoming-movies-backend`, `upcoming-movies-frontend`
- **Builds on / coordinates with:**
  - [2026-06-19-full-tmdb-capture-normalization-design.md](2026-06-19-full-tmdb-capture-normalization-design.md) — the `catalog` reference + join-table normalization pattern this milestone extends.
  - [2026-06-25-mvp-launch-polish-m02-polish-existing-pages.md](2026-06-25-mvp-launch-polish-m02-polish-existing-pages.md) — **NEU-396** widens the same `FilmDetailResponse` / `get_film_detail` this milestone extends further. M5 **adds to**, never rewrites, NEU-396's fields.
  - **Film search milestone — NEU-400** (`GET /films/search`): NEU-406 extends that endpoint to also match alternate titles.
  - **Release calendar milestone — `GET /calendar`**: NEU-404's `film_release_date` schema is the substrate that endpoint queries. The calendar endpoint itself is out of scope here; the schema + index are designed to serve it.
- **Stories & tickets:**
  - Story [NEU-389](https://linear.app/neuroticsasquatch/issue/NEU-389) — *Film page shows cast & crew*
    - [NEU-402](https://linear.app/neuroticsasquatch/issue/NEU-402) `[backend]` — ingest TMDB credits (new `person` + `film_credit` schema), expose top-billed cast + director(s) on the film-detail DTO.
    - [NEU-403](https://linear.app/neuroticsasquatch/issue/NEU-403) `[frontend]` — Cast & crew section on `/film/{slug}` (blocked by NEU-402).
  - Story [NEU-390](https://linear.app/neuroticsasquatch/issue/NEU-390) — *Film page shows release dates*
    - [NEU-404](https://linear.app/neuroticsasquatch/issue/NEU-404) `[backend]` — ingest TMDB per-country `release_dates` (new `film_release_date` schema), expose relevant dates on the DTO; schema serves the calendar.
    - [NEU-405](https://linear.app/neuroticsasquatch/issue/NEU-405) `[frontend]` — Release-dates section on the film page (blocked by NEU-404).
  - Story [NEU-391](https://linear.app/neuroticsasquatch/issue/NEU-391) — *Alternate titles improve search and show on the film page*
    - [NEU-406](https://linear.app/neuroticsasquatch/issue/NEU-406) `[backend]` — ingest TMDB `alternative_titles` (new `film_alternative_title` schema), extend `GET /films/search` to match alt titles, expose notable alt-titles on the DTO (blocked by NEU-400).
    - [NEU-407](https://linear.app/neuroticsasquatch/issue/NEU-407) `[frontend]` — "Also known as" line on the film page (blocked by NEU-406).
- **Scope shape:** six PRs — one per ticket, branch per ticket (Linear-provided). Each FE ticket waits on its BE ticket's merged DTO; NEU-406 also waits on NEU-400.

## Purpose & scope

Today `catalog.film` is a rich-but-flat record: the M1–M2 work surfaces the basics already on the
film row (overview, tagline, runtime, genres, rating, production companies, collection). But the
TMDB `/movie/{id}` **base** payload omits three relationally-meaningful sub-objects we have never
ingested: **credits** (cast & crew), **per-country release dates**, and **alternative titles**.
The `Film` model docstring already reserves the seam —

> *"downstream projects extend the `catalog` schema (people, credits) without altering this seam."*

— but no `person`/`credit` tables exist yet. M5 realizes that seam and two adjacent ones, turning
each film page into an "everything we know about this film" view.

This is the first milestone that **requires new data from TMDB** beyond the base details object. The
defining cost decision (below) is that all three sub-objects are pulled in the **same** per-film
`/movie/{id}` request via `append_to_response`, so steady-state TMDB call volume stays at **one call
per film** — not four.

In scope (backend): three new normalized schemas under `catalog`, their Pydantic DTOs + client
wiring (`ingest/tmdb/schemas.py`, `client.py`), upsert orchestration (`ingest/tmdb/upsert.py`),
three additive Alembic migrations, three additions to `FilmDetailResponse` / `get_film_detail`
(`public/dto.py`, `public/service.py`), and the `GET /films/search` alt-title extension. In scope
(frontend): three new film-page sections + their `FilmDetail` type extensions + tests. Out of scope:
see the final section (reviews are explicitly cut; no person/filmography pages).

## Decisions

| Question | Decision |
|---|---|
| How to fetch the three sub-objects | **`append_to_response=credits,release_dates,alternative_titles`** on the existing `/movie/{id}` call — **one** HTTP request per film, not four. TMDB bundles up to 20 appended sub-requests into one response. |
| Ingest-time vs read-time normalization | **Ingest-time** — normalize into tables during the existing tmdb upsert (consistent with full-tmdb-capture). Read path uses scoped explicit `select`s (no `relationship()`), per the NEU-396 style. |
| `person` key | **Natural key** = TMDB person `id` (Integer PK, `autoincrement=False`), mirroring `genre`/`production_company`. Upserted `ON CONFLICT (id) DO UPDATE` (names/profile paths drift). |
| `film_credit` key | **`credit_id` (Text) PK** — TMDB's stable per-credit id. A person can hold multiple credits on one film (multiple jobs, multiple characters), so a `(film_id, person_id)` composite is insufficient. |
| Cast/crew capture depth | **Store the full `cast` and `crew` arrays.** Capture-once (mirrors full-tmdb-capture); the DTO surfaces only a bounded slice. Avoids re-ingesting if we later want writers/producers. Verbatim copy is also in `tmdb_raw`. |
| `film_release_date` / `film_alternative_title` keys | **Surrogate `id` (BigInteger identity) PK + delete-and-reinsert rebuild** per film. `(film_id, country, type)` is **not** unique (re-releases, multiple AKAs per country), so no natural composite. |
| Country FK on release-dates / alt-titles | **Plain `Text`, no FK** to `catalog.production_country`. Release/title countries routinely include codes a film never lists as a production country; an FK would reject valid rows. (Diverges from the `film_production_country` FK pattern on purpose.) |
| Alt-title search index type | **Coordinate with NEU-400.** Use the *same* matching strategy/index the primary `film.title` search uses (e.g. both `pg_trgm` GIN, or both `lower()` btree + `ILIKE`). Do not introduce a second, inconsistent search mechanism. |
| Backfill of existing films | Additive schema only — **no data migration in the Alembic file.** The appended sub-objects were never in the old `tmdb_raw`, so backfill requires re-fetching. The next scheduled ingest re-fetches in-window films idempotently; a one-off admin re-ingest covers the rest. Dev: `TRUNCATE catalog.film CASCADE` + re-ingest. |
| Migration count | **Three** additive migrations (one per backend ticket / PR), chaining in merge order off the current head `6d7e2769ba35`. |

## Architecture & approach

### Shared plumbing (touched by all three backend tickets)

**TMDB client (`ingest/tmdb/client.py`).** `movie_details` currently does a bare `GET /movie/{id}`.
Add the append param so the three sub-objects ride along in the one response:

```python
async def movie_details(self, tmdb_id: int) -> TMDBMovieDetails:
    url = f"{self._base_url}/movie/{tmdb_id}"
    resp = await self._request(
        "GET", url,
        params={"append_to_response": "credits,release_dates,alternative_titles"},
    )
    data = resp.json()
    details = TMDBMovieDetails.model_validate(data)
    details.tmdb_raw = data   # now also carries the appended sub-objects (verbatim hedge)
    return details
```

The appended objects arrive as nested keys on the same JSON: `credits: {cast, crew}`,
`release_dates: {results: [...]}`, `alternative_titles: {titles: [...]}`. They land in `tmdb_raw`
verbatim (so we can backfill future fields without re-ingesting), and are parsed into typed DTO
fields on `TMDBMovieDetails` (`extra="ignore"` keeps us tolerant). **Cost note:** because everything
is appended, per-film TMDB traffic stays at **1 request** — the same as today. The only extra cost is
a one-time corpus re-fetch during backfill (see Cross-cutting).

**Upsert orchestration (`ingest/tmdb/upsert.py`).** `upsert_film` stays a small orchestration inside
the caller's transaction (the service still commits once per film). Each ticket appends its own
step(s) following the **exact** existing shape: reference rows upserted by natural key
(`ON CONFLICT (pk) DO UPDATE`); per-film detail/join rows **rebuilt** (`DELETE … WHERE film_id = :id`
then bulk insert) so a film gaining/dropping a credit, date, or AKA between runs is reflected. All
steps are guarded `if details.<field>:` so a film lacking a sub-object is a no-op.

**Read path (`public/service.py::get_film_detail`).** Continues the NEU-396 pattern: after the `Film`
row is fetched, add a few small scoped `select`s keyed by `film.id`. No `relationship()` is added to
`Film`. Deterministic ordering (`order_by`) on every list for SSR/snapshot stability. These run once
per film-detail request (one film), so the extra round-trips are cheap.

---

### Story NEU-389 — cast & crew

#### NEU-402 `[backend]` — ingest credits

**Schema (`catalog`).**

`catalog.person` — reference table (natural key):

| Column | Type | TMDB source | Notes |
|---|---|---|---|
| `id` | Integer PK, `autoincrement=False` | `id` | TMDB person id |
| `name` | Text, not null | `name` | |
| `original_name` | Text, nullable | `original_name` | |
| `profile_path` | Text, nullable | `profile_path` | FE builds the image URL |
| `known_for_department` | Text, nullable | `known_for_department` | |
| `gender` | Integer, nullable | `gender` | TMDB enum (0–3) |
| `popularity` | Float, nullable | `popularity` | |

`catalog.film_credit` — the credit edge (rebuilt per film):

| Column | Type | Notes |
|---|---|---|
| `credit_id` | Text PK | TMDB's stable per-credit id |
| `film_id` | UUID, FK → `catalog.film.id` `ON DELETE CASCADE`, not null | |
| `person_id` | Integer, FK → `catalog.person.id`, not null | |
| `credit_type` | Text, not null | `'cast'` or `'crew'` |
| `department` | Text, nullable | `'Acting'` for cast; crew `department` (e.g. `'Directing'`) |
| `job` | Text, nullable | crew `job` (e.g. `'Director'`); null for cast |
| `character` | Text, nullable | cast `character`; null for crew |
| `credit_order` | Integer, nullable | cast `order` (top-billing); null for crew |

Indexes: `ix_catalog_film_credit_film` on `film_id` (the read is always film-scoped);
`ix_catalog_film_credit_person` on `person_id` (FK hygiene; enables a future filmography without a
re-ingest — but no person page ships here).

**DTOs / client (`ingest/tmdb/schemas.py`).** New nested models (`extra="ignore"`):
`TMDBCastMember(id, name, original_name, profile_path, known_for_department, gender, popularity,
character, order, credit_id)` and `TMDBCrewMember(… , department, job, credit_id)`. `TMDBCredits(cast:
list[TMDBCastMember], crew: list[TMDBCrewMember])`. `TMDBMovieDetails` gains `credits: TMDBCredits |
None = None`.

**Upsert.** Add to `upsert_film`: collect the union of cast+crew people → `insert(Person)…
on_conflict_do_update` (names/profile drift). Then rebuild `film_credit`: `DELETE WHERE film_id`, bulk
insert one row per cast member (`credit_type='cast'`, `credit_order=order`, `character`) and one per
crew member (`credit_type='crew'`, `job`, `department`). Same delete-and-reinsert idempotency as the
existing joins.

**Migration.** One additive migration: `create_table('person', …)`, `create_table('film_credit', …)`
+ the two indexes, `schema='catalog'`. No data step. `down_revision` = the then-current head (starts
from `6d7e2769ba35`).

**DTO / read path (`public/dto.py`, `public/service.py`).** Extend `FilmDetailResponse` (the **same**
DTO NEU-396 widens):

| DTO field | Selection | Notes |
|---|---|---|
| `cast: list[CastMemberOut]` | `film_credit` where `credit_type='cast'`, **`order by credit_order asc nulls last, person name`, limit N (≈10–15)** | `CastMemberOut{ name, character, profile_path }` |
| `directors: list[str]` | `film_credit` where `credit_type='crew' and job='Director'`, joined to `person.name`, `order by credit_order/name` | director name(s) |

"**Top-billed**" = cast ordered by `credit_order` ascending, capped at N. "**Director(s)**" = crew rows
with `job='Director'` (TMDB can list co-directors). Both are computed in the read query (join
`film_credit` → `person`). Order genres/cast deterministically.

#### NEU-403 `[frontend]` — cast & crew section

- `src/api/types.ts` — extend `FilmDetail`: `cast: { name: string; character: string | null;
  profile_path: string | null }[]`, `directors: string[]`.
- Add `src/lib/poster.ts` sibling `profileUrl(path, size)` (same `env.tmdbImageBase` base, profile
  size e.g. `w185`) — a 3-line analog of the existing `posterUrl`.
- New `src/components/film/FilmCredits.tsx`, rendered from `film.tsx` below the core-info section: a
  director line + a horizontal cast list (profile image when `profile_path` present, else an
  initials/placeholder; name; character). Every field null-guarded (omit cleanly), per the M2 contract.
- Tests: component test (cast with/without images, director(s) present/absent, empty credits omits the
  whole section); `film.test.tsx` fixture extended.

---

### Story NEU-390 — release dates

#### NEU-404 `[backend]` — ingest per-country release dates

**Schema (`catalog`).** `catalog.film_release_date` — granular per-(film, country, type, date) rows,
rebuilt per film:

| Column | Type | TMDB source | Notes |
|---|---|---|---|
| `id` | BigInteger identity PK | — | surrogate (no natural uniqueness) |
| `film_id` | UUID, FK → `catalog.film.id` `ON DELETE CASCADE`, not null | — | |
| `iso_3166_1` | Text, not null | `results[].iso_3166_1` | country; **plain text, no FK** |
| `release_type` | Integer, not null | `release_dates[].type` | 1=Premiere, 2=Theatrical (limited), 3=Theatrical, 4=Digital, 5=Physical, 6=TV |
| `release_date` | `DateTime(timezone=True)`, not null | `release_dates[].release_date` | TMDB returns full ISO `…T00:00:00.000Z`; store as timestamptz |
| `certification` | Text, nullable | `certification` | e.g. `"PG-13"` |
| `note` | Text, nullable | `note` | |
| `iso_639_1` | Text, nullable | `iso_639_1` | language tag |

Indexes:
- `ix_catalog_film_release_date_film` on `film_id` — the film-page read.
- **`ix_catalog_film_release_date_lookup` on `(release_date, release_type)`** — the forward-looking
  calendar query. `GET /calendar` does `WHERE release_date >= :today AND release_date < :horizon AND
  release_type IN (…)` ordered by date across **all** films; indexing the date column (not just
  `film_id`) is what makes that range scan efficient.

**Why this schema serves both surfaces.** The film page reads `WHERE film_id = :id`; the calendar
reads a date-range scan over the whole table. Storing every country×type date (rather than a single
collapsed "release date") lets each surface apply its own policy — the calendar picks a canonical date
(e.g. earliest US theatrical, or global-earliest of types 2/3) via a `MIN(release_date) … GROUP BY
film_id` query; the film page shows the home-region rows. The **schema is the shared substrate; the
canonical-date policy is the calendar milestone's concern**, not designed-in here. (For UTC date
bucketing the calendar can reuse the existing `cast(func.timezone('UTC', …), Date)` idiom from
`get_feed_grouped`.)

**DTOs / client.** `TMDBReleaseDate(certification, iso_639_1, note, release_date: datetime, type:
int)`; `TMDBReleaseDatesByCountry(iso_3166_1, release_dates: list[TMDBReleaseDate])`;
`TMDBReleaseDates(results: list[TMDBReleaseDatesByCountry])`. `TMDBMovieDetails` gains `release_dates:
TMDBReleaseDates | None = None`.

**Upsert.** Add to `upsert_film`: rebuild `film_release_date` — `DELETE WHERE film_id`, then bulk
insert one row per (country, entry), flattening `results[].release_dates[]`. No reference table.

**Migration.** Additive: `create_table('film_release_date', …)` + the two indexes, `schema='catalog'`.

**DTO / read path.** Extend `FilmDetailResponse`:

| DTO field | Selection | Notes |
|---|---|---|
| `release_dates: list[ReleaseDateOut]` | `film_release_date` filtered to a **home region** (default `'US'`; configurable) plus the film's `origin_country[0]` if different, all 6 types, ordered by `release_date` | `ReleaseDateOut{ country, release_type, type_label, date, certification }` |

`type_label` maps the integer to a human label (`1→"Premiere"`, `2→"Theatrical (limited)"`,
`3→"Theatrical"`, `4→"Digital"`, `5→"Physical"`, `6→"TV"`) — a small pure map in `public/`. We surface
a curated regional slice, **not** all ~50 countries (that lives in `tmdb_raw`). The home region is a
constant (US) with room to make it a setting later.

#### NEU-405 `[frontend]` — release-dates section

- `src/api/types.ts` — `release_dates: { country: string; release_type: number; type_label: string;
  date: string; certification: string | null }[]`.
- New `src/components/film/ReleaseDates.tsx`, rendered from `film.tsx`: labeled rows (type label · date
  · certification), grouped/ordered by date; omit the section entirely when empty.
- Tests: rows render with labels + certs; section omitted when `release_dates` is empty.

---

### Story NEU-391 — alternate titles

#### NEU-406 `[backend]` — ingest alt titles + extend search

**Schema (`catalog`).** `catalog.film_alternative_title` — rebuilt per film:

| Column | Type | TMDB source | Notes |
|---|---|---|---|
| `id` | BigInteger identity PK | — | surrogate |
| `film_id` | UUID, FK → `catalog.film.id` `ON DELETE CASCADE`, not null | — | |
| `iso_3166_1` | Text, nullable | `titles[].iso_3166_1` | country; **plain text, no FK** |
| `title` | Text, not null | `titles[].title` | |
| `title_type` | Text, nullable | `titles[].type` | e.g. `"working title"`, `"AKA"` |

Indexes: `ix_catalog_film_alt_title_film` on `film_id` (film-page read) **and a `title` index whose
type matches NEU-400's primary-title search** (e.g. `pg_trgm` GIN on `lower(title)` if search is
trigram, or a `lower(title)` btree if search is `ILIKE`-prefix). The search infra does not exist yet
(no trigram/FTS in the repo today), so the *exact* index is chosen to mirror NEU-400's — they must use
one consistent strategy.

**DTOs / client.** `TMDBAlternativeTitle(iso_3166_1, title, type)`;
`TMDBAlternativeTitles(titles: list[TMDBAlternativeTitle])`. `TMDBMovieDetails` gains
`alternative_titles: TMDBAlternativeTitles | None = None` (the appended key is `alternative_titles`).

**Upsert.** Rebuild `film_alternative_title` — `DELETE WHERE film_id`, bulk insert one row per title.

**Migration.** Additive: `create_table('film_alternative_title', …)` + indexes, `schema='catalog'`.

**Search extension (touches NEU-400's `GET /films/search`).** NEU-400 builds the search endpoint
matching `catalog.film.title`. NEU-406 **extends that same query** to also match
`film_alternative_title.title`, returning the film once (de-duplicated). Concretely: add an `EXISTS`
correlated subquery (or a `LEFT JOIN … DISTINCT`) so a film matches when **either** its primary title
**or** any alternate title matches, using the same normalization the primary match uses. This is the
one place M5 modifies another milestone's endpoint — hence **NEU-406 is blocked by NEU-400** and must
rebase onto the merged search service. Primary-title hits should still rank ahead of alt-title-only
hits (preserve NEU-400's ordering; alt-title is an additional match path, not a reorder).

**DTO / read path.** Extend `FilmDetailResponse`: `alternative_titles: list[str]` — distinct titles
that differ from `film.title` and `film.original_title`, deduped, ordered (e.g. alphabetical), capped
to a notable handful. (We don't surface country/type on the page — just the names.)

#### NEU-407 `[frontend]` — "Also known as"

- `src/api/types.ts` — `alternative_titles: string[]`.
- An "Also known as: …" line in the core-info/credits area of `film.tsx` (or a tiny component),
  rendered only when the list is non-empty.
- Tests: line renders the titles; omitted when empty.

## Cross-cutting decisions

- **One appended fetch, not four.** `append_to_response=credits,release_dates,alternative_titles`
  keeps per-film TMDB volume at **1 request**. The three backend tickets each *add their own DTO
  parsing + upsert step*, but the client change (adding the append param) lands with whichever ticket
  merges first; the others widen the param if sequencing requires. The verbatim appended JSON is
  retained in `tmdb_raw`.
- **Ingest-time normalization; read-time projection.** Data is normalized into tables during the
  existing tmdb ingest (one commit per film, one film's failure never rolls back others). The film
  page and the calendar *project* from those tables at read time with scoped `select`s — no
  `relationship()` on `Film`, consistent with NEU-396.
- **Idempotent upserts.** `person` upserted by natural key; `film_credit` / `film_release_date` /
  `film_alternative_title` rebuilt delete-and-reinsert per film (handles churn between runs). Re-running
  ingest over the same film is a no-op-equivalent (same final state). The caller owns the transaction.
- **Backfill = re-fetch, not a data migration.** The appended sub-objects were never stored (old
  `tmdb_raw` is the un-appended `/movie/{id}`), so existing rows can't be backfilled from the DB — they
  must be re-fetched. Steady state: the next scheduled tmdb ingest re-enumerates in-window films and
  re-fetches them idempotently with the new append param, populating the new tables for free. Films no
  longer in the discover window are covered by a one-off admin re-ingest that iterates stored
  `tmdb_id`s through `movie_details`. **Dev:** `TRUNCATE catalog.film CASCADE` (the new tables cascade
  via `film_id`) + re-ingest. This one-time re-fetch of the existing corpus (~230 films) is the only
  extra TMDB cost; steady-state stays at 1 call/film. The Alembic migrations contain **no** data step.
- **Shared DTO coordination (with NEU-396).** All three backend tickets add fields to the **same**
  `FilmDetailResponse` and the same `get_film_detail`, which NEU-396 (M2) also widens, and the same
  FE `FilmDetail` type / `film.tsx`. M5 **extends**, never rewrites, NEU-396's additions; sequence M5
  after NEU-396 (or rebase) to avoid churn. Expect to touch `public/dto.py`, `public/service.py`,
  `api/types.ts`, and `film.tsx` in additive ways across the milestone — keep each ticket's diff
  scoped to its own fields.
- **`film_release_date` is the calendar's substrate.** Granular per-country/per-type rows + the
  `(release_date, release_type)` index let `GET /calendar` (other milestone) run an efficient
  forward-looking range scan and pick its own canonical-date policy. M5 ships the schema, index, and
  the film-page projection only — not the calendar endpoint.
- **Selection semantics.** Top-billed cast = `credit_order asc nulls last`, capped at N (≈10–15).
  Director(s) = crew `job='Director'`. Release dates surfaced = home-region (US) + origin-country slice
  across all 6 types. Alt titles surfaced = distinct titles differing from the primary/original title.
- **Local CI gate before each PR.** BE: `task test` / `task lint` / `task typecheck` (+ `task format`,
  + `alembic heads` is single-headed). FE: `tsc -b` + eslint@0-warnings + vitest. Mock TMDB with respx
  (incl. the appended payload); never hit the live network.

## Milestone acceptance

1. **Credits (NEU-389):** the tmdb ingest fetches credits via `append_to_response` (no extra HTTP
   call), populating `catalog.person` + `catalog.film_credit`; `GET /films/{slug}` exposes top-billed
   `cast` (name/character/profile_path) and `directors`; `/film/{slug}` renders a cast & crew section
   that omits cleanly when empty.
2. **Release dates (NEU-390):** ingest populates `catalog.film_release_date` (per-country, typed);
   the DTO exposes a labeled home-region/origin slice; `/film/{slug}` renders a release-dates section.
   The schema + `(release_date, release_type)` index support an efficient forward-looking calendar
   query (verified by an `EXPLAIN`/query test that the index is used for a date-range scan).
3. **Alt titles (NEU-391):** ingest populates `catalog.film_alternative_title`; `GET /films/search`
   matches alternate titles in addition to the primary title (a film findable by an AKA), returning
   each film once with primary-title hits ranked first; the DTO exposes notable `alternative_titles`;
   `/film/{slug}` shows an "Also known as" line.
4. Three additive migrations apply cleanly and chain single-headed off `6d7e2769ba35`; no data step.
   Per-film TMDB call volume is unchanged (1 request/film) — confirmed by a respx assertion that
   `movie_details` issues a single request carrying `append_to_response`.
5. All backend and frontend checks green; NEU-396 / M2 fields and the existing grouping + SSR tests
   still pass unchanged.

## Out of scope

- **Reviews / ratings authoring are explicitly cut.** No user reviews, no review ingestion, no
  TMDB/critic review surfacing. (TMDB's existing `vote_average`/`vote_count` already shown via NEU-396
  is the only rating signal.)
- **No person / filmography pages.** We ingest `person` rows and this film's credits only; there is no
  `/person/{id}` page, no "other films by" navigation, no cross-film credit browsing. `film_credit`'s
  `person_id` index leaves that door open for a later milestone without a re-ingest, but nothing here
  builds it.
- **The `GET /calendar` endpoint itself** — M5 ships only the schema + index that back it.
- **The `GET /films/search` endpoint itself** (NEU-400, Film search milestone) — M5 only **extends** it
  to also match alt titles.
- **No full crew surfacing.** Full cast+crew is *stored*, but only top-billed cast + directors are on
  the DTO/page (writers/producers/etc. stay in the tables + `tmdb_raw`).
- **No images/videos ingestion** (`append_to_response=images,videos`) — a separate concern from the
  three sub-objects scoped here.
- **No visual redesign** — three clean additive sections on the existing film page, not a re-layout.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
