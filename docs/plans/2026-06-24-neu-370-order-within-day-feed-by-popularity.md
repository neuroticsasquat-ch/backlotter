# NEU-370 — Order within-day home feed by film popularity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Within each day of the grouped public home feed (`GET /feed/grouped`), order films by `catalog.film.popularity` descending (nulls last), tie-breaking by `slug` ascending, so the biggest titles lead each day.

**Architecture:** A one-function change to `get_feed_grouped` in `src/upmovies/public/service.py` — swap the within-day `ORDER BY` key from `max(Event.created_at) DESC` to `nulls_last(Film.popularity.desc())`. The query already `GROUP BY Film.id` (the PK), so ordering by `Film.popularity` is valid via PK functional dependency — no change to the GROUP BY. No DTO, schema, migration, router, or frontend change: the response shape is identical and the frontend's `groupByDay` preserves backend order verbatim.

**Tech Stack:** Python 3.13, SQLAlchemy 2 (async) + asyncpg, FastAPI, pytest (pytest-asyncio `auto` mode), respx. Everything runs in the container via `task` targets — **no host Python**.

## Global Constraints

- **Run everything in the container via `task`** — never run `pytest`/`ruff`/`pyright`/`python` on the host. Source is bind-mounted, so edits are live; keep the container up (`task up`).
- **Before claiming done:** `task test`, `task lint`, `task typecheck` must all be green; run `task format` first (ruff reformats).
- **No schema change:** `Film.popularity` is `Mapped[float | None]` (`catalog/models.py:50`) and already exists — no model edit, no Alembic migration.
- **No DTO / router / frontend change:** `FeedDayItem`/`FeedDayResponse` are unchanged; `get_feed_grouped`'s signature and return type are unchanged; the FE consumes backend order as-is.
- **Use the repo's nulls-last idiom:** `nulls_last(<col>.desc())` (standalone function already imported at `service.py:5`), matching the four existing usages (e.g. `service.py:68`). Do **not** use the `.nullslast()` column-method form the ticket text suggests.
- **Integration-test isolation quirk:** running a *single* integration test *file* in isolation errors with a pytest-asyncio session-loop warning. Run the whole suite (`task test`) or scope to a *directory* (`task test -- tests/integration/routers/`), never a lone file.
- **Commit conventions (this repo):** Conventional Commits subject (`refactor:`/`feat:`), **no** Linear ID in the subject (optional `Refs NEU-370.` in the body), **no** `🤖 Generated with Claude Code` footer in commits, **no** `Co-Authored-By` trailer. Pre-commit hooks delegate into Docker — commit normally (no `--no-verify`).

---

## Setup (once, before Task 1)

Create the work branch off `main` in the backend repo:

```bash
cd /Users/trb74/projects/upcoming-movies/upcoming-movies-backend
git checkout main && git pull --ff-only
git checkout -b tom/neu-370-backend-order-within-day-home-feed-by-film-popularity
task up   # ensure the container is running
```

---

## Task 1: Order within-day grouped feed by film popularity

**Files:**
- Modify: `tests/fixtures/public.py:23-45` (extend the `make_film` fixture with a `popularity` kwarg)
- Modify: `tests/integration/routers/test_public_feed_grouped.py:72-81` (replace the created-at ordering test with three popularity ordering tests)
- Modify: `src/upmovies/public/service.py:238-266` (`get_feed_grouped`: drop `last_created`, change the within-day `ORDER BY` key)

**Interfaces:**
- Consumes: `make_film(*, slug, title=..., status=..., release_date=..., poster_path=..., popularity=None)` → `Film`; `add_event(*, film, event_type=..., summary=..., created_at=..., ...)` → `Event`; the `client` fixture (`GET /feed/grouped` → `{items, total, limit, offset}` where each item has `film_slug`, `film_title`, `poster_path`, `day`, `top_event_type`, `event_count`).
- Produces: no new public interface. `get_feed_grouped(session, *, limit, offset) -> FeedDayResponse` is unchanged in signature/return type; only the within-day row order changes.

---

- [ ] **Step 1: Extend the `make_film` fixture to accept `popularity`**

In `tests/fixtures/public.py`, add a `popularity` keyword (default `None`, backward-compatible — existing callers are unaffected) and pass it to the `Film(...)` constructor. The full updated fixture:

```python
@pytest.fixture
def make_film(session: AsyncSession):
    counter = {"n": 0}

    async def _make(
        *,
        slug: str,
        title: str = "A Film",
        status: str | None = "Planned",
        release_date: date | None = date(2026, 7, 17),
        poster_path: str | None = "/poster.jpg",
        popularity: float | None = None,
    ) -> Film:
        counter["n"] += 1
        film = Film(
            tmdb_id=1000 + counter["n"],
            slug=slug,
            title=title,
            status=status,
            release_date=release_date,
            poster_path=poster_path,
            popularity=popularity,
        )
        session.add(film)
        await session.commit()
        await session.refresh(film)
        return film

    return _make
```

- [ ] **Step 2: Replace the within-day ordering test with three popularity tests**

In `tests/integration/routers/test_public_feed_grouped.py`, **delete** the existing `test_grouped_within_day_orders_by_latest_event_time` function (lines 72-81 — it encodes the old created-at behaviour and would now be wrong) and replace it with the three tests below. Each is constructed so it **fails under the current `max(created_at) DESC` ordering** and **passes under popularity ordering**:

```python
async def test_grouped_within_day_orders_by_popularity(client, make_film, add_event):
    # Same UTC day. Popularity must win over BOTH slug order and event time:
    # zzz-blockbuster (pop 90, earlier event) precedes aaa-popular (pop 5, later event),
    # even though "aaa" < "zzz" and aaa's event is more recent.
    low = await make_film(slug="aaa-popular", popularity=5.0)
    high = await make_film(slug="zzz-blockbuster", popularity=90.0)
    await add_event(film=low, summary="low", created_at=datetime(2026, 6, 5, 22, tzinfo=UTC))
    await add_event(film=high, summary="high", created_at=datetime(2026, 6, 5, 8, tzinfo=UTC))

    items = (await client.get("/feed/grouped")).json()["items"]
    assert [i["film_slug"] for i in items] == ["zzz-blockbuster", "aaa-popular"]


async def test_grouped_within_day_null_popularity_sorts_last(client, make_film, add_event):
    # A film with no popularity sorts after one that has popularity, regardless of slug:
    # aaa-nopop (None) has the alphabetically-first slug but must come last.
    nopop = await make_film(slug="aaa-nopop", popularity=None)
    haspop = await make_film(slug="zzz-haspop", popularity=10.0)
    await add_event(film=nopop, summary="nopop", created_at=datetime(2026, 6, 5, tzinfo=UTC))
    await add_event(film=haspop, summary="haspop", created_at=datetime(2026, 6, 5, tzinfo=UTC))

    items = (await client.get("/feed/grouped")).json()["items"]
    assert [i["film_slug"] for i in items] == ["zzz-haspop", "aaa-nopop"]


async def test_grouped_within_day_equal_popularity_ties_break_by_slug(client, make_film, add_event):
    # Equal popularity falls back to slug ascending (NOT event time):
    # aaa-2026 wins on slug even though bbb-2026 has the later event.
    a = await make_film(slug="aaa-2026", popularity=10.0)
    b = await make_film(slug="bbb-2026", popularity=10.0)
    await add_event(film=a, summary="a", created_at=datetime(2026, 6, 5, 8, tzinfo=UTC))
    await add_event(film=b, summary="b", created_at=datetime(2026, 6, 5, 22, tzinfo=UTC))

    items = (await client.get("/feed/grouped")).json()["items"]
    assert [i["film_slug"] for i in items] == ["aaa-2026", "bbb-2026"]
```

(`datetime`, `UTC` are already imported at the top of the file.)

- [ ] **Step 3: Run the new tests to verify they FAIL**

Run (directory-scoped — never the lone file, per the isolation quirk):

```bash
task test -- tests/integration/routers/test_public_feed_grouped.py -k within_day
```

Expected: the three `within_day` tests FAIL — the current `max(created_at) DESC` ordering returns `["aaa-popular", ...]` / `["aaa-nopop", ...]` / `["bbb-2026", ...]`, i.e. the reverse of each asserted order.

- [ ] **Step 4: Change the within-day ORDER BY in `get_feed_grouped`**

In `src/upmovies/public/service.py`, make two edits inside `get_feed_grouped`:

1. **Delete** the now-unused `last_created` line (line 240) — leaving it triggers ruff F841 (assigned but never used):

```python
    day = cast(func.timezone("UTC", Event.created_at), Date)
    last_created = func.max(Event.created_at)   # <-- DELETE THIS LINE
```

2. **Change** the `order_by` (line 262) from `last_created.desc()` to `nulls_last(Film.popularity.desc())`:

```python
    rows = (
        await session.execute(
            base.order_by(day.desc(), nulls_last(Film.popularity.desc()), Film.slug.asc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
```

`nulls_last` is already imported (`service.py:5`); `Film` is already imported. No other change — `day.desc()` (cross-day, newest first) and `Film.slug.asc()` (tie-break) are retained, and the `GROUP BY Film.id` already covers ordering by `Film.popularity`.

- [ ] **Step 5: Run the new tests to verify they PASS**

```bash
task test -- tests/integration/routers/test_public_feed_grouped.py -k within_day
```

Expected: all three `within_day` tests PASS.

- [ ] **Step 6: Run the full grouped-feed file + the public router directory to confirm no regressions**

```bash
task test -- tests/integration/routers/test_public_feed_grouped.py
task test -- tests/integration/routers/
```

Expected: all PASS. The other grouped tests are single-film or cross-day, so the within-day key change does not affect them; the public-films/feed/sitemap tests are unrelated.

- [ ] **Step 7: Run the full CI gate locally**

```bash
task format      # ruff reformat (run BEFORE lint/commit)
task lint        # ruff check src tests
task typecheck   # pyright src tests
task test        # full suite
```

Expected: all green. (No migration in this change, so no `alembic heads` concern.)

- [ ] **Step 8: Commit**

```bash
git add src/upmovies/public/service.py tests/fixtures/public.py tests/integration/routers/test_public_feed_grouped.py
git commit -m "refactor: order within-day grouped feed by film popularity

Refs NEU-370."
```

(Conventional Commits subject, no Linear ID in the subject, no footer, no co-author — per repo conventions.)

---

## Self-Review

**1. Spec coverage** (ticket = the spec):
- "Within each day, order by `catalog.film.popularity` descending (nulls last), tie-break by slug" → Step 4 (`nulls_last(Film.popularity.desc())`, `Film.slug.asc()`), proven by Step 2's three tests. ✓
- "Day-grouping + newest-day-first already handled" → `day.desc()` retained. ✓
- "No FE / DTO change" → no DTO/router/FE files touched; response shape unchanged. ✓
- "`Film.popularity` already exists — no schema change" → no model/migration edit. ✓
- "GROUP BY Film.id → ordering by popularity allowed" → confirmed; GROUP BY untouched. ✓
- Ticket-omitted details now covered: the conflicting `test_grouped_within_day_orders_by_latest_event_time` is replaced (Step 2); the dead `last_created` line is removed (Step 4); the `make_film` fixture gains a `popularity` param (Step 1). ✓
- Idiom correction: used `nulls_last(...)` (repo standard) instead of the ticket's `.nullslast()`. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to" — every code step shows full code. ✓

**3. Type consistency:** `make_film` gains `popularity: float | None = None` (matches `Film.popularity: Mapped[float | None]`); `nulls_last`/`Film` already imported; `get_feed_grouped` signature unchanged. ✓
