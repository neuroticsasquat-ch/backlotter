# NEU-408 review context bundle

## Linear ticket

- **ID / title:** NEU-408 — `[backend] GET /calendar endpoint (upcoming by date + release type)`
- **State:** In Review
- **Project / milestone:** Movies: MVP Launch Polish · milestone **M6 — Release calendar**
- **Parent:** NEU-373 ("Public release calendar" story)
- **Description:** New public `GET /calendar` returning upcoming releases (today forward) grouped/orderable by release date and release type, reading the `release_dates` ingested in NEU-404. Define the type mapping (limited / wide / festival≈premiere) and the response envelope. BE repo.

## Linear hierarchy & relations

- **blocks:** NEU-409 — `[frontend] Release calendar page (/calendar)`
- **blockedBy:** NEU-404 — `[backend] Ingest TMDB release_dates (+types) + expose on DTO` (defines `catalog.film_release_date`)
- **relatedTo:** none

## Spec & plan (intent the implementation is measured against)

- **Plan:** `docs/plans/2026-06-25-neu-408-calendar-endpoint.md`
- **Milestone spec:** `docs/specs/2026-06-25-mvp-launch-polish-m06-release-calendar.md`

### Key contract points (from plan + spec)

- `GET /calendar?limit&offset` → `CalendarResponse {items, total, limit, offset}`; `limit` `Query(default=100, ge=1, le=200)`, `offset` `Query(default=0, ge=0)`; out-of-range → 422; empty → 200 `{items: [], total: 0}`.
- `CalendarItem`: `film_slug: str`, `film_title: str`, `poster_path: str | None`, `release_date: date` ("YYYY-MM-DD", US date), `release_type: str` (bucket string `premiere|limited|wide`, never raw TMDB int).
- **Future-first:** `release_date >= today (UTC, computed in Python via `datetime.now(tz=UTC).date()`, NOT SQL CURRENT_DATE)`, today inclusive.
- **Single region:** `iso_3166_1 = CALENDAR_REGION ("US")` named constant; no cross-country fallback.
- **Bucketing:** TMDB `type` 1→premiere, 2→limited, 3→wide; festival collapses into premiere; types 4/5/6 excluded. The SQL `IN (...)` filter must be **derived from the bucket-map keys** (`tuple(_TMDB_TYPE_TO_BUCKET)`) so the surfaced set can't drift.
- **De-dup:** one row per `(film, US date, bucket)` via GROUP BY/DISTINCT; a film with both a limited and wide US date → two rows.
- **Ordering:** `release_date ASC, release_type ASC, popularity DESC NULLS LAST, slug ASC`.
- **Visibility:** `slug IS NOT NULL` + `NOT adult`, **no summary gate** (the divergence from /films & /feed — dated-but-quiet films must surface).
- **`total`:** count over the grouped subquery — number of `(film, date, bucket)` rows in the window.
- **Scope discipline:** read-path only; touch exactly `public/release.py`, `public/service.py`, `public/dto.py`, `routers/public.py`, the new integration test, `tests/fixtures/public.py`, and `tests/unit/public/test_release.py`. No migration / model / ingestion change. `alembic heads` unchanged & single.
- **Resilience note:** `release_date` is `DateTime(timezone=True)` per NEU-404 → reduce to UTC calendar date via `cast(func.timezone("UTC", col), Date)` for both cutoff and emitted value; if NEU-404 landed plain `Date`, drop the cast.

### Acceptance criteria (plan §Acceptance)

1. Envelope + bounds (422 out of range, 200 empty).
2. Future-first, UTC today computed in Python, today inclusive.
3. Ordering + one row per (film, US date, bucket); `total` = window count.
4. Type map 1/2/3 → buckets via pure helper; festival→premiere; 4/5/6 excluded; SQL IN derived from map.
5. Date scoped to US named constant; no US row → not listed.
6. Visibility slug-not-null + not-adult, no summary gate (test asserts no-summary film lists).
7. Full test coverage; `task format/lint/typecheck/test` green; no migration; diff confined to listed files.
