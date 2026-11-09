# `catalog.film.slug` + backfill (SEO public URLs) — Design

- **Date:** 2026-06-22
- **Status:** Approved (ready for implementation plan)
- **Component:** `upcoming-movies-backend` — `catalog` package (new `slug` module + model column), `ingest/tmdb/upsert` (insert hook), one Alembic migration
- **Linear:** NEU-308 (one PR, backend) · project *Movies: Synthesis & Update Log* · milestone *M3 — Per-movie update log*
- **Parent story:** NEU-301 (*Story: Per-movie chronological update log*)
- **Blocks:** NEU-309 (*[backend] Public film index/detail API + sitemap* — resolves films by slug), NEU-311 (*[backend] Global "updated today" feed API*)
- **Design-of-record:** [2026-06-22-synthesis-update-log-design.md](2026-06-22-synthesis-update-log-design.md) §"Schema (`catalog.film` — extended)" / "Slugs" decision. This document is the per-ticket implementation design for the M3 slug deliverable.

## What this is

SEO-friendly public film URLs. Public film pages live at `/film/{slug}` (e.g. `the-odyssey-2026`),
not at a UUID. This ticket adds a `slug` column to the `catalog.film` spine, generates it on insert
for new films, and backfills every existing row — so the public read API (NEU-309) can resolve films
by a stable, human-readable key.

NEU-308 ships **only** the column, its generation logic, the insert-path hook, and the backfill
migration. It touches **no router and no read path**.

### Out of scope (NEU-309 and later)

- The public `GET /films` / `GET /films/{slug}` resolution API and `GET /sitemap.xml` → **NEU-309**.
- Any change to slugs once assigned. Slugs are **immutable** after their initial assignment (URL/SEO
  stability); a film's title changing upstream does **not** regenerate its slug.

## Decisions

| Question | Decision |
|---|---|
| Base slug form | `slugify(title)` + `-{release_year}` when `release_date` is set; bare `slugify(title)` when it is null. |
| Slugify implementation | **`python-slugify`** — transliterates non-ASCII via unidecode (`Amélie`→`amelie`, CJK/Cyrillic→romanized), strips punctuation, lowercases, hyphenates. One new dependency. |
| Empty-stem fallback | If `slugify(title)` is empty (untransliterable title), the slug is `film-{tmdb_id}` (already globally unique — no year, no collision step). |
| Collision disambiguation | On clash, append `-{tmdb_id}` (globally unique → deterministic in one step, no retry/increment loop, no positional fragility). The lowest-`tmdb_id` film keeps the clean base. |
| Assignment timing | Assigned **once, on insert only**; excluded from the upsert's `ON CONFLICT DO UPDATE` set, so it is frozen forever after. |
| Constraint | **unique + indexed** via a named unique index `ix_catalog_film_slug`. **Nullable** at the DB. The AC requires unique+indexed, not NOT NULL; in practice every row is slugged (backfill fills all existing rows; the upsert assigns one to every new film), so nulls never occur in prod. Staying nullable means **zero** changes to the ~29 direct `Film(...)` test constructions (Postgres treats NULLs as distinct under a unique index) for no functional loss. NOT NULL can be added later in a one-line migration if ever wanted. |

## Architecture

```
                       pure (no DB, unit-testable)
   catalog/slug.py ──► base_slug(title, release_date, tmdb_id) -> str
                   └─► resolve_unique(base, taken: set[str], tmdb_id) -> str
                            │                         │
        ┌───────────────────┘                         └────────────────────┐
        ▼ live insert path                                    ▼ migration backfill
  assign_slug(session, …)  (async, DB-aware)            backfill_slugs(rows) -> [(id, slug)]
   - base_slug(...)                                      - rows ordered by tmdb_id ASC
   - SELECT slug WHERE slug = base   (clash check)       - walk maintaining a `taken` set
   - resolve_unique(...)                                 - base_slug + resolve_unique per row
        │                                                       │
        ▼                                                       ▼
  ingest/tmdb/upsert._upsert_film_row                    Alembic upgrade()
   (slug in INSERT VALUES, NOT in update_set)            (add nullable column → backfill → unique index)
```

The **pure** core (`base_slug`, `resolve_unique`) is the single source of truth shared by both the
live path and the backfill. The two contexts differ only in how they build the "already taken" view:
a targeted `SELECT` in the live async path, an in-memory `set` accumulated in tmdb_id order in the
sync migration.

## Slug module — `src/upmovies/catalog/slug.py`

**Pure:**

- `base_slug(title: str, release_date: date | None, tmdb_id: int) -> str`
  - `stem = slugify(title)`.
  - `stem == ""` → return `f"film-{tmdb_id}"`.
  - else → `f"{stem}-{release_date.year}"` if `release_date` else `stem`.
- `resolve_unique(base: str, taken: set[str], tmdb_id: int) -> str`
  - `base` if `base not in taken`, else `f"{base}-{tmdb_id}"`.
- `backfill_slugs(rows: list[tuple[id, title, release_date, tmdb_id]]) -> list[tuple[id, str]]`
  - Assumes `rows` are **pre-sorted by tmdb_id ascending** (the migration sorts). Walks them
    maintaining a `taken` set, applying `base_slug` + `resolve_unique`, adding each result to `taken`.
    Pure and deterministic — directly unit-tested for collisions and ordering.

**DB-aware (live path):**

- `assign_slug(session: AsyncSession, *, title: str, release_date: date | None, tmdb_id: int) -> str`
  - Computes `base`; `SELECT slug FROM catalog.film WHERE slug = :base` to build `taken`; returns
    `resolve_unique(...)`. The DB unique constraint is the final backstop (an `IntegrityError` on the
    `-{tmdb_id}` form is not expected — `tmdb_id` is unique — but the constraint guarantees correctness
    under any race).

## Model + insert-path wiring

**`catalog/models.py` — `Film`**: add a nullable column (after `tmdb_id`) and a **named unique index**
in `__table_args__` (so the test schema via `create_all` and prod via the migration share the index
name `ix_catalog_film_slug`):

```python
slug: Mapped[str | None] = mapped_column(Text, nullable=True)
...
__table_args__ = (
    Index("ix_catalog_film_slug", "slug", unique=True),
    {"schema": "catalog"},
)
```

(`Index` is added to the existing `sqlalchemy` import.) `create_all` builds the unique index for tests;
prod gets the identically-named index from the migration.

**`ingest/tmdb/upsert.py` — `_upsert_film_row`:** slug is assigned only on insert and frozen after.

- Pre-`SELECT slug FROM catalog.film WHERE tmdb_id = :tmdb_id`.
  - **Existing film** → reuse the stored slug in the INSERT `VALUES` (discarded on `DO UPDATE`, but keeps
    `VALUES` valid and skips a needless clash query).
  - **New film** → `await assign_slug(session, …)`.
- `slug` is included in `VALUES` but **excluded from `update_set`**, so an existing row's slug is never
  recomputed — even when the upstream title changes.

## Backfill migration

One Alembic migration (`task makemigration -- "add catalog.film.slug"`, then hand-edit the data step):

1. `op.add_column("film", sa.Column("slug", sa.Text(), nullable=True), schema="catalog")`.
2. **Backfill:** `SELECT id, title, release_date, tmdb_id FROM catalog.film ORDER BY tmdb_id` via
   `op.get_bind()`; pass to `backfill_slugs(...)` (imported pure helper); `UPDATE` each row's slug.
   tmdb_id ordering makes "who wins the clean base" deterministic.
3. Create the **named unique index** `ix_catalog_film_slug` on `slug` (the column stays nullable).

Downgrade: drop the unique index, then drop the column. The migration imports only the **pure** helpers
(`base_slug`, `resolve_unique`, `backfill_slugs`) — no async/session dependency, no duplicated logic.

## Testing (TDD, in-container via `task`)

- **`base_slug`** (unit): `"The Odyssey"` + 2026 → `the-odyssey-2026`; `"Amélie"` + 2001 → `amelie-2001`;
  `"Spider-Man: No Way Home"` + 2021 → `spider-man-no-way-home-2021`; `release_date=None` → `the-odyssey`;
  untransliterable/empty stem → `film-{tmdb_id}`.
- **`resolve_unique` / `backfill_slugs`** (unit): a clashing base gets the `-{tmdb_id}` suffix; assignment
  is deterministic in tmdb_id order (lowest wins the clean base); the produced slug set is fully unique.
- **Upsert** (integration, `session` fixture): a new film gets a slug on insert; re-upserting the same
  `tmdb_id` with a changed title **preserves** the original slug; two films sharing title+year → the
  second resolves to `-{tmdb_id}`; the DB unique constraint rejects a manual duplicate.
- **Backfill** is covered through `backfill_slugs` (the pure assignment the migration delegates to),
  re-read with `execution_options={"populate_existing": True}` where integration rows are involved.
- No churn to existing `Film(...)` test constructions: `slug` is nullable, so the ~29 direct
  constructions that omit it keep passing (multiple NULLs are allowed under the unique index).

`task test` / `task lint` / `task typecheck` green (`task format` first); `pyproject.toml` gains
`python-slugify` (latest), installed via `task build`.
