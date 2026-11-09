# `catalog.film.slug` + Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an SEO-friendly, collision-safe `slug` to `catalog.film` (derived from title + release year), assign it on insert for new films, and backfill every existing row — so the public film API (NEU-309) can resolve films by a stable, human-readable key instead of a UUID.

**Architecture:** A new `catalog/slug.py` splits **pure** slug logic (`base_slug`, `resolve_unique`, `backfill_slugs` — no DB, unit-tested) from a **DB-aware** `assign_slug` (queries the unique index, async). The TMDB upsert path (`ingest/tmdb/upsert._upsert_film_row`) assigns a slug **only on insert** and keeps it frozen by excluding `slug` from its `ON CONFLICT DO UPDATE` set. One Alembic migration adds the nullable column, backfills existing rows in `tmdb_id` order (reusing the pure helpers — one source of truth), and creates the named unique index. The column is **nullable + unique + indexed** (the AC's requirement); it is never NULL in practice (every existing row is backfilled, every new row is assigned), and staying nullable means **zero** changes to the ~29 existing direct `Film(...)` test constructions.

**Tech Stack:** Python 3.13, SQLAlchemy 2 (async) + asyncpg, Alembic, `python-slugify` (new dep — unidecode transliteration of non-ASCII titles), pytest (pytest-asyncio **auto** mode — no `@pytest.mark.asyncio`), ruff, pyright. All tooling runs in the container via `task` (never raw `pytest`/`ruff`/`pyright`/`alembic`/`python` on the host).

**Ticket:** NEU-308 (one PR, backend). Parent story NEU-301. **Blocks** NEU-309 (public film index/detail API + sitemap) and NEU-311 (global "updated today" feed API). Design-of-record: `docs/specs/2026-06-22-neu-308-film-slug-backfill-design.md`; project design: `docs/specs/2026-06-22-synthesis-update-log-design.md`.

**Commits / shipping:** This whole plan is a single ticket = single PR. Do **not** add per-step `git commit` calls; commit once at the end via `/t:ship` (run `task format` first, then commit normally — pre-commit hooks delegate into the container, so no `--no-verify`). If running subagent-driven, **strip any commit step from implementer prompts** — the user commits once at the end. Implement in a **Sonnet/high** session per the model/effort workflow; this Opus session produced the design + plan only.

**Out of scope (downstream):** the public `GET /films` / `GET /films/{slug}` resolution API and `GET /sitemap.xml` (NEU-309); the feed API (NEU-311); any FE; any change to a slug after its initial assignment (slugs are immutable for URL/SEO stability). No new **required** env.

---

## Reference: contracts the implementer needs

### `catalog.film` today (`src/upmovies/catalog/models.py`)

`Film` — `id` uuid PK (`server_default gen_random_uuid()`), `tmdb_id` Integer **unique** not-null, `title` Text not-null, `release_date` **Date nullable**, `status`/`overview`/… , `created_at`/`updated_at`. Current table args: `__table_args__ = {"schema": "catalog"}`. **No `slug` yet.**

### The upsert path today (`src/upmovies/ingest/tmdb/upsert.py`)

`_upsert_film_row` builds a `values` dict, derives `update_set = {k: v for k, v in values.items() if k != "tmdb_id"}` + `updated_at = func.now()`, and runs a single

```python
insert(Film).values(**values).on_conflict_do_update(index_elements=[Film.tmdb_id], set_=update_set).returning(Film.id)
```

Imports today: `from sqlalchemy import delete, func`. Pure DB I/O — the caller owns the transaction (commit/rollback).

### `make_details` test fixture (`tests/fixtures/tmdb.py`)

`make_details(tmdb_id, **overrides)` returns a `/movie/{id}` payload. Defaults: `title=f"Movie {tmdb_id}"`, **`release_date="2026-07-15"`** (→ year 2026), `status="Released"`. Override title via `make_details(1, title="Dune")`.

### Test DB lifecycle (`tests/conftest.py`)

The `session` fixture **TRUNCATEs all `catalog`/`app`/`news`/`ingest` tables after every test** (`RESTART IDENTITY CASCADE`), so each test starts empty — within-test rows are the only ones that coexist. The schema is built from the models via `create_all` (so the new column + index reach tests automatically). After Core-level upserts, re-read rows with `execution_options={"populate_existing": True}` (the existing `_films()` helper in `test_upsert.py` already does this).

### `slugify` behavior (the new dep)

`from slugify import slugify`: lowercases, transliterates non-ASCII via unidecode, strips punctuation, hyphen-joins. `slugify("Spider-Man: No Way Home") == "spider-man-no-way-home"`, `slugify("Amélie") == "amelie"`, `slugify("!!!") == ""` (empty — the fallback trigger).

---

## File Structure

- **Modify** `pyproject.toml` — add `python-slugify` (runtime) + `types-python-slugify` (dev, pyright).
- **Create** `src/upmovies/catalog/slug.py` — pure `base_slug` / `resolve_unique` / `backfill_slugs` + async `assign_slug` (built across Tasks 2, 3, 5).
- **Modify** `src/upmovies/catalog/models.py` — add the `slug` column + named unique index in `__table_args__`.
- **Modify** `src/upmovies/ingest/tmdb/upsert.py` — assign slug on insert; exclude from the update set.
- **Create** `migrations/versions/<rev>_add_catalog_film_slug.py` — add column + backfill + unique index.
- **Create** `tests/unit/catalog/__init__.py` (empty) + `tests/unit/catalog/test_slug.py` — pure-helper unit tests.
- **Modify** `tests/integration/test_models.py` — nullable + unique constraint test.
- **Modify** `tests/integration/ingest/tmdb/test_upsert.py` — slug-on-insert, frozen-on-update, collision tests.

No FE. No new required env.

---

## Task 1: Add the `python-slugify` dependency

**Files:**
- Modify: `pyproject.toml`

- [ ] **Step 1: Add the runtime + stub dependencies**

In `pyproject.toml`, add to `[project].dependencies` (after the `anthropic` line):

```toml
    "python-slugify>=8.0",
```

And to `[project.optional-dependencies].dev` (after the `httpx>=0.28` line):

```toml
    "types-python-slugify>=1.1",
```

- [ ] **Step 2: Rebuild the image so the dep installs**

Run: `task build`
Expected: the image rebuilds; `python-slugify` and `types-python-slugify` install without conflict. (Per the backend CLAUDE.md, `pyproject.toml` changes require `task build` — a bind-mount alone won't pick up new deps.)

- [ ] **Step 3: Confirm the existing suite still imports/runs**

Run: `task test`
Expected: green (no behavior changed yet; this only proves the rebuilt image is healthy).

---

## Task 2: Pure slug core — `base_slug` + `resolve_unique`

**Files:**
- Create: `tests/unit/catalog/__init__.py` (empty)
- Create: `tests/unit/catalog/test_slug.py`
- Create: `src/upmovies/catalog/slug.py`

- [ ] **Step 1: Create the empty test package marker**

Create `tests/unit/catalog/__init__.py` with no content:

```python
```

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/catalog/test_slug.py`:

```python
from datetime import date

from upmovies.catalog.slug import base_slug, resolve_unique


def test_base_slug_title_and_year():
    assert base_slug("The Odyssey", date(2026, 7, 15), 1) == "the-odyssey-2026"


def test_base_slug_transliterates_non_ascii():
    assert base_slug("Amélie", date(2001, 4, 25), 2) == "amelie-2001"


def test_base_slug_strips_punctuation():
    assert base_slug("Spider-Man: No Way Home", date(2021, 12, 17), 3) == "spider-man-no-way-home-2021"


def test_base_slug_without_release_date_omits_year():
    assert base_slug("The Odyssey", None, 4) == "the-odyssey"


def test_base_slug_empty_stem_falls_back_to_tmdb_id():
    # an all-punctuation / untransliterable title slugifies to "" → deterministic unique fallback
    assert base_slug("!!!", date(2026, 1, 1), 99) == "film-99"


def test_resolve_unique_passes_through_when_free():
    assert resolve_unique("dune-2026", set(), 5) == "dune-2026"


def test_resolve_unique_appends_tmdb_id_on_clash():
    assert resolve_unique("dune-2026", {"dune-2026"}, 5) == "dune-2026-5"
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `task test -- tests/unit/catalog/test_slug.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'upmovies.catalog.slug'`.

- [ ] **Step 4: Create `slug.py` with the pure core**

Create `src/upmovies/catalog/slug.py`:

```python
"""Slug generation for `catalog.film` public URLs. The pure functions (`base_slug`,
`resolve_unique`, `backfill_slugs`) are the single source of truth shared by the live insert
path and the Alembic backfill; `assign_slug` wraps them with the DB clash check. Slugs are
derived from title + release year, collision-safe via a deterministic `-{tmdb_id}` suffix, and
immutable once assigned."""

from datetime import date

from slugify import slugify


def base_slug(title: str, release_date: date | None, tmdb_id: int) -> str:
    """`<slugified-title>-<year>`, or the bare title slug when there is no release date.
    An empty stem (untransliterable / all-punctuation title) falls back to `film-{tmdb_id}`,
    which is already globally unique (tmdb_id is unique), so it needs no year or collision step."""
    stem = slugify(title)
    if not stem:
        return f"film-{tmdb_id}"
    if release_date is not None:
        return f"{stem}-{release_date.year}"
    return stem


def resolve_unique(base: str, taken: set[str], tmdb_id: int) -> str:
    """Return `base` if free, else append `-{tmdb_id}` (deterministic, globally unique)."""
    return f"{base}-{tmdb_id}" if base in taken else base
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `task test -- tests/unit/catalog/test_slug.py -v`
Expected: PASS — all seven tests.

---

## Task 3: Pure batch backfill — `backfill_slugs`

**Files:**
- Modify: `src/upmovies/catalog/slug.py`
- Test: `tests/unit/catalog/test_slug.py`

- [ ] **Step 1: Write the failing test**

First extend the import block at the top of `tests/unit/catalog/test_slug.py`:

```python
from datetime import date
from uuid import uuid4

from upmovies.catalog.slug import backfill_slugs, base_slug, resolve_unique
```

Then add this test:

```python
def test_backfill_slugs_assigns_unique_slugs_in_tmdb_order():
    a, b, c = uuid4(), uuid4(), uuid4()
    rows = [
        (a, "Dune", date(2026, 7, 15), 1),
        (b, "Dune", date(2026, 7, 15), 2),  # same base as `a` → disambiguated by tmdb_id
        (c, "Wicked", None, 3),
    ]
    out = dict(backfill_slugs(rows))
    assert out[a] == "dune-2026"
    assert out[b] == "dune-2026-2"
    assert out[c] == "wicked"
    assert len(set(out.values())) == 3  # all unique
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/unit/catalog/test_slug.py -k backfill -v`
Expected: FAIL — `ImportError: cannot import name 'backfill_slugs'` (the module-level import now fails, so the file errors on collection — expected).

- [ ] **Step 3: Add `backfill_slugs`**

In `src/upmovies/catalog/slug.py`, add `from uuid import UUID` to the imports (below `from datetime import date`), then append at the end of the file:

```python
def backfill_slugs(
    rows: list[tuple[UUID, str, date | None, int]],
) -> list[tuple[UUID, str]]:
    """Assign a unique slug to each `(id, title, release_date, tmdb_id)` row. Callers pass rows
    pre-sorted by `tmdb_id` ascending so the lowest tmdb_id deterministically wins the clean base
    and disambiguation is stable. Pure — the migration delegates its backfill to this."""
    taken: set[str] = set()
    out: list[tuple[UUID, str]] = []
    for film_id, title, release_date, tmdb_id in rows:
        slug = resolve_unique(base_slug(title, release_date, tmdb_id), taken, tmdb_id)
        taken.add(slug)
        out.append((film_id, slug))
    return out
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- tests/unit/catalog/test_slug.py -v`
Expected: PASS — all eight tests (the original seven + `test_backfill_slugs_assigns_unique_slugs_in_tmdb_order`).

---

## Task 4: Model column + named unique index

**Files:**
- Modify: `src/upmovies/catalog/models.py`
- Test: `tests/integration/test_models.py`

- [ ] **Step 1: Write the failing test**

First add `import pytest` to the top of `tests/integration/test_models.py` (it currently imports `from datetime import UTC, datetime` and the models; add `pytest` and the `IntegrityError`):

```python
import pytest
from sqlalchemy.exc import IntegrityError
```

Then add this test:

```python
async def test_film_slug_nullable_and_unique(session):
    # nullable: a film can be created without a slug (multiple NULLs are allowed)
    session.add(Film(tmdb_id=1, title="No Slug Yet"))
    session.add(Film(tmdb_id=2, title="Also No Slug"))
    await session.flush()

    # unique: two films cannot share the same non-null slug
    session.add(Film(tmdb_id=3, title="A", slug="dupe-2026"))
    session.add(Film(tmdb_id=4, title="B", slug="dupe-2026"))
    with pytest.raises(IntegrityError):
        await session.flush()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/integration/test_models.py::test_film_slug_nullable_and_unique -v`
Expected: FAIL — `TypeError: 'slug' is an invalid keyword argument for Film` (the column doesn't exist yet).

- [ ] **Step 3: Add the column + named unique index**

In `src/upmovies/catalog/models.py`:

(a) add `Index` to the existing `sqlalchemy` import block (alongside `BigInteger, Boolean, Date, …`):

```python
    Index,
```

(b) in `class Film`, replace the table args and add the column. Change:

```python
    __tablename__ = "film"
    __table_args__ = {"schema": "catalog"}
```

to:

```python
    __tablename__ = "film"
    __table_args__ = (
        Index("ix_catalog_film_slug", "slug", unique=True),
        {"schema": "catalog"},
    )
```

and add the column directly after the `tmdb_id` line:

```python
    slug: Mapped[str | None] = mapped_column(Text, nullable=True)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- tests/integration/test_models.py::test_film_slug_nullable_and_unique -v`
Expected: PASS — the column exists (nullable, multiple NULLs OK) and the unique index rejects the duplicate `slug`.

- [ ] **Step 5: Confirm no existing model/integration test regressed**

Run: `task test -- tests/integration/test_models.py -v`
Expected: PASS — the ~29 existing direct `Film(...)` constructions across the suite still work (slug is nullable, so omitting it is fine). The broader suite is re-confirmed in Task 7.

---

## Task 5: `assign_slug` + wire it into the TMDB upsert

**Files:**
- Modify: `src/upmovies/catalog/slug.py`
- Modify: `src/upmovies/ingest/tmdb/upsert.py`
- Test: `tests/integration/ingest/tmdb/test_upsert.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/ingest/tmdb/test_upsert.py` (it already has `make_details`, `_films`, `upsert_film`, `TMDBMovieDetails` imported):

```python
async def test_upsert_assigns_slug_on_insert(session):
    await upsert_film(session, TMDBMovieDetails.model_validate(make_details(27205, title="Inception")))
    await session.commit()
    assert (await _films(session))[0].slug == "inception-2026"


async def test_upsert_preserves_slug_when_title_changes(session):
    await upsert_film(session, TMDBMovieDetails.model_validate(make_details(1, title="Old Title")))
    await session.commit()
    original_slug = (await _films(session))[0].slug
    assert original_slug == "old-title-2026"

    await upsert_film(session, TMDBMovieDetails.model_validate(make_details(1, title="Brand New Title")))
    await session.commit()
    film = (await _films(session))[0]
    assert film.title == "Brand New Title"
    assert film.slug == original_slug, "slug is frozen on insert — never regenerated on update"


async def test_upsert_disambiguates_slug_collision_with_tmdb_id(session):
    # two distinct films with the same title + release year (defaults to 2026-07-15)
    await upsert_film(session, TMDBMovieDetails.model_validate(make_details(1, title="Dune")))
    await session.commit()
    await upsert_film(session, TMDBMovieDetails.model_validate(make_details(2, title="Dune")))
    await session.commit()

    films = await _films(session)  # ordered by tmdb_id ascending
    assert films[0].slug == "dune-2026"
    assert films[1].slug == "dune-2026-2"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `task test -- tests/integration/ingest/tmdb/test_upsert.py -k slug -v`
Expected: FAIL — `assert None == "inception-2026"` (the upsert doesn't set `slug` yet; the column stays NULL).

- [ ] **Step 3: Add `assign_slug` to `slug.py`**

In `src/upmovies/catalog/slug.py`, add these imports (below the existing `from datetime import date` / `from uuid import UUID`):

```python
from slugify import slugify  # already present from Task 2 — keep a single import
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from upmovies.catalog.models import Film
```

(Keep only one `from slugify import slugify` line; add `select`, `AsyncSession`, and `Film`.) Then append at the end of the file:

```python
async def assign_slug(
    session: AsyncSession, *, title: str, release_date: date | None, tmdb_id: int
) -> str:
    """Collision-safe slug for a NEW film. Builds the base, checks the unique index for a clash,
    and disambiguates with `-{tmdb_id}` if needed. The DB unique constraint is the final backstop."""
    base = base_slug(title, release_date, tmdb_id)
    clash = (
        await session.execute(select(Film.slug).where(Film.slug == base).limit(1))
    ).scalar_one_or_none()
    return resolve_unique(base, {base} if clash is not None else set(), tmdb_id)
```

- [ ] **Step 4: Wire the slug into `_upsert_film_row`**

In `src/upmovies/ingest/tmdb/upsert.py`:

(a) extend the imports — change `from sqlalchemy import delete, func` to:

```python
from sqlalchemy import delete, func, select
```

and add (below the `from upmovies.catalog.models import (...)` block):

```python
from upmovies.catalog.slug import assign_slug
```

(b) replace the body of `_upsert_film_row`. Change the start of the function from:

```python
    values = {
        "tmdb_id": details.id,
        "imdb_id": details.imdb_id,
```

to:

```python
    slug = await _slug_for_insert(session, details)
    values = {
        "tmdb_id": details.id,
        "slug": slug,
        "imdb_id": details.imdb_id,
```

and change the `update_set` line from:

```python
    update_set = {k: v for k, v in values.items() if k != "tmdb_id"}
```

to (slug is set once on insert and must never be rewritten):

```python
    update_set = {k: v for k, v in values.items() if k not in ("tmdb_id", "slug")}
```

(c) add this helper directly after `_upsert_film_row`:

```python
async def _slug_for_insert(session: AsyncSession, details: TMDBMovieDetails) -> str | None:
    """An existing film (matched on `tmdb_id`) keeps its stored slug — it is excluded from the
    `DO UPDATE` set, so the value here is only used when the row is actually inserted. A new film
    gets a freshly assigned collision-safe slug."""
    row = (
        await session.execute(select(Film.slug).where(Film.tmdb_id == details.id))
    ).one_or_none()
    if row is not None:
        return row[0]
    return await assign_slug(
        session, title=details.title, release_date=details.release_date, tmdb_id=details.id
    )
```

`_upsert_film_row` already imports `AsyncSession` and `TMDBMovieDetails` at module top, and `Film` is in the `upmovies.catalog.models` import block — no further imports needed for the helper.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `task test -- tests/integration/ingest/tmdb/test_upsert.py -v`
Expected: PASS — the three new slug tests plus all existing upsert tests (insert/update/idempotency/joins) stay green.

---

## Task 6: Alembic migration — add column, backfill, unique index

**Files:**
- Create: `migrations/versions/<rev>_add_catalog_film_slug.py`

- [ ] **Step 1: Autogenerate the migration**

Run: `task makemigration -- "add catalog.film.slug"`
Expected: a new file `migrations/versions/<rev>_add_catalog_film_slug.py` whose `down_revision` is the current head (`72cefc645fdc`, the `event_summary` migration). Autogenerate detects the new column **and** the named index, emitting `op.add_column(...)` + `op.create_index("ix_catalog_film_slug", ...)`. (If the dev DB isn't at head, run `task migrate` first, then re-generate.)

- [ ] **Step 2: Hand-edit `upgrade()` / `downgrade()` to insert the backfill**

Replace the generated `upgrade()` and `downgrade()` bodies with exactly this (keeps the autogenerated `revision` / `down_revision` / imports at the top of the file; ensure `import sqlalchemy as sa` and `from alembic import op` are present, as Alembic generates them):

```python
def upgrade() -> None:
    op.add_column("film", sa.Column("slug", sa.Text(), nullable=True), schema="catalog")

    # Backfill existing rows in tmdb_id order (deterministic: lowest tmdb_id wins the clean base),
    # reusing the same pure helper the live insert path is built on.
    from upmovies.catalog.slug import backfill_slugs

    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT id, title, release_date, tmdb_id FROM catalog.film ORDER BY tmdb_id")
    ).fetchall()
    for film_id, slug in backfill_slugs([(r.id, r.title, r.release_date, r.tmdb_id) for r in rows]):
        bind.execute(
            sa.text("UPDATE catalog.film SET slug = :slug WHERE id = :id"),
            {"slug": slug, "id": film_id},
        )

    op.create_index("ix_catalog_film_slug", "film", ["slug"], unique=True, schema="catalog")


def downgrade() -> None:
    op.drop_index("ix_catalog_film_slug", table_name="film", schema="catalog")
    op.drop_column("film", "slug", schema="catalog")
```

(`op.get_bind()` is a **synchronous** connection here — `migrations/env.py` runs migrations inside `connection.run_sync(...)` — so `bind.execute(...).fetchall()` returns rows directly. `r.release_date` is a `date`/`None`, exactly what `backfill_slugs` expects.)

- [ ] **Step 3: Apply the migration**

Run: `task migrate`
Expected: `alembic upgrade head` succeeds — column added, existing rows backfilled, unique index `ix_catalog_film_slug` created. (On a fresh dev DB with no films, the backfill loop is a no-op; the column + index still land.)

- [ ] **Step 4: Verify the migration round-trips (up → down → up)**

Run: `task shell` then inside the container: `alembic downgrade -1 && alembic upgrade head`
Expected: downgrade drops the index + column cleanly; re-upgrade re-adds + re-backfills without error. Exit the shell. (This confirms `downgrade()` is correct and the migration is replayable.)

---

## Task 7: Full green + ship

**Files:** none (verification + ship)

- [ ] **Step 1: Format**

Run: `task format`
Expected: ruff reformats `src` + `tests`; a re-run is clean. Keep lines ≤ 100 chars (watch the long test-call lines in `test_upsert.py`).

- [ ] **Step 2: Lint**

Run: `task lint`
Expected: `ruff check src tests` clean. Confirm no unused imports — `select` is now used in both `slug.py` and `upsert.py`; `Index` is used in `models.py`; `pytest`/`IntegrityError` are used in `test_models.py`.

- [ ] **Step 3: Typecheck**

Run: `task typecheck`
Expected: `pyright src tests` clean. `assign_slug` returns `str`; `_slug_for_insert` returns `str | None` (assigned into the nullable `slug` column value); `base_slug`/`resolve_unique`/`backfill_slugs` are fully typed. (`types-python-slugify` gives `slugify` a real signature.)

- [ ] **Step 4: Full repo test pass**

Run: `task test`
Expected: green across the whole suite — the new unit + integration tests plus every pre-existing test (the nullable column left the ~29 direct `Film(...)` constructions untouched). Per the backend CLAUDE.md, run the **whole** suite (a single integration file in isolation can error on a pytest-asyncio session-loop quirk).

- [ ] **Step 5: Ship**

Commit once and open the PR with `/t:ship` (it sets the branch — `tom/neu-308-backend-catalogfilmslug-backfill` — runs `/commit-msg` + `/pr-desc`, and targets the release branch). Do **not** commit per-task. Run `task format` first; commit normally (pre-commit hooks delegate into the container — no `--no-verify`).

---

## Self-Review (completed during authoring)

- **Spec coverage:** `base_slug` = `slugify(title)`+year, bare-title when no date, `film-{tmdb_id}` empty-stem fallback (Task 2) · `resolve_unique` `-{tmdb_id}` disambiguation (Task 2) · `backfill_slugs` pure, tmdb_id-ordered, unique (Task 3) · `slug` column **nullable + unique + indexed** via named index `ix_catalog_film_slug` (Task 4) · `assign_slug` DB clash check (Task 5) · slug assigned **on insert only** and **excluded from the update set** so it is frozen (Task 5, asserted by `test_upsert_preserves_slug_when_title_changes`) · migration adds nullable column → backfills in tmdb_id order via the shared pure helper → creates the unique index, with a clean downgrade (Task 6) · `task format`/`lint`/`typecheck`/`test` green + `python-slugify` dep (Tasks 1, 7). Every spec section maps to a task; the public read API + sitemap are explicitly NEU-309.
- **Placeholder scan:** none — every code/test step shows complete code and exact `task` commands. `<rev>` in the migration filename is Alembic's autogenerated revision hash (Task 6 Step 1), not a placeholder for the implementer to invent.
- **Type consistency:** `base_slug(title, release_date, tmdb_id) -> str` and `resolve_unique(base, taken, tmdb_id) -> str` are called identically by `backfill_slugs` and `assign_slug`. `assign_slug(session, *, title, release_date, tmdb_id) -> str` matches its one call site in `_slug_for_insert`. `_slug_for_insert(session, details) -> str | None` feeds `values["slug"]` (nullable column). The migration reads `(id, title, release_date, tmdb_id)` in the exact order `backfill_slugs` unpacks. The index name `ix_catalog_film_slug` is identical in the model (`__table_args__`), the Task 4 reasoning, and the migration `create_index`/`drop_index`.
- **TDD import ordering:** Task 2's test imports only `base_slug`/`resolve_unique` (defined in Task 2), so Task 2 ends green. Task 3 first extends the import to add `backfill_slugs`; until it exists the file errors on collection — that `ImportError` is the expected red. Tasks 4–5 add behavior to already-imported symbols, so their red step is an assertion/`TypeError`, not an import error.
- **Dependency ordering:** Task 1 (dep + `task build`) precedes any `from slugify import slugify`. Task 4 (model column) precedes Task 5 (upsert queries `Film.slug`) and Task 6 (autogenerate needs the model delta). `slug.py` imports `Film` from `catalog.models`, which does **not** import `slug.py` — no import cycle.
