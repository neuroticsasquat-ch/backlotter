# Calendar Row Enrichment Implementation Plan (NEU-437)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a poster thumbnail, director(s), top-3 stars, and up to 3 genres on each release-calendar film row.

**Architecture:** Backend extends the `GET /calendar` response (`CalendarItem`) with `director`/`stars`/`genres`, populated by three small per-page metadata queries keyed by film id (no row multiplication). Frontend extends the `CalendarItem` type and rewrites `CalendarFilmRow` into a poster-left media row. All data already exists in the DB — **no migrations**.

**Tech Stack:** Backend — FastAPI, SQLAlchemy 2 async, Pydantic v2, pytest (in-container via `task`). Frontend — React + TS, react-router, Tailwind v4, Vitest + RTL (in-container via `task`).

## Global Constraints

- **No DB migrations** — `poster_path`, directors/cast (`catalog.film_credit` + `catalog.person`), and genres (`catalog.film_genre` + `catalog.genre`) already exist and are ingested from TMDB.
- **Stars:** names only, capped at **3**, ordered by `credit_order` (nulls last) then name.
- **Genres:** capped at **3**, ordered by name.
- **Director:** all credits where `credit_type='crew'` and `job='Director'`, ordered by `credit_order` (nulls last) then name, joined with `", "`; `null` when none.
- **Graceful omission:** no poster → placeholder box (no `<img>`); no director → omit line; empty stars/genres → omit line. Title link always renders.
- **Everything runs in containers via `task`** — never run `pytest`/`ruff`/`pyright`/`pnpm`/`vitest`/`tsc` on the host.
- Backend: a single integration test *file* run in isolation errors on a pytest-asyncio loop quirk — **scope to the directory** (`tests/integration/routers`), not the file.
- Backend commit subjects: Conventional Commits, **no** Linear ID in subject. Frontend commit subjects: Conventional Commits with trailing `(NEU-437)`. PR titles in both repos carry `(NEU-437)`. No `Co-Authored-By`. The `🤖 Generated with Claude Code` footer goes in PR bodies only (frontend commits may keep it; backend commits must not).
- Each task ships as **its own PR** (1 ticket = 1 PR); frontend is blocked by backend (it consumes the new API fields).

---

## File Structure

**Backend (`upcoming-movies-backend`)**
- Modify `src/upmovies/public/dto.py` — add 3 fields to `CalendarItem`.
- Modify `src/upmovies/public/service.py` — add `Film.id` to the calendar row select; add 3 metadata helpers; populate the new DTO fields.
- Modify `tests/integration/routers/test_public_calendar.py` — add coverage for the new fields.

**Frontend (`upcoming-movies-frontend`)**
- Modify `src/api/types.ts` — add 3 fields to `CalendarItem`.
- Modify `src/components/calendar/CalendarFilmRow.tsx` — rewrite as poster-left media row.
- Modify `src/components/calendar/CalendarFilmRow.test.tsx` — rewrite tests for the new layout.

---

## Task 1: Backend — enrich the calendar API (own PR)

**Files:**
- Modify: `src/upmovies/public/dto.py:122-128` (the `CalendarItem` model)
- Modify: `src/upmovies/public/service.py:603-673` (`get_calendar`) + new module-level helpers
- Test: `tests/integration/routers/test_public_calendar.py`

**Interfaces:**
- Consumes: existing models `Film`, `FilmReleaseDate`, `FilmCredit`, `Person`, `Genre`, `FilmGenre` (all already imported in `service.py`); fixtures `make_film`, `add_release_date`, `attach_genres(film, [(id, name)])`, `attach_credits(film, cast=[...], crew=[...])` from `tests/fixtures/public.py`.
- Produces: `CalendarItem` JSON now includes `director: str | null`, `stars: list[str]`, `genres: list[str]`. Frontend Task 2 relies on exactly these field names/types.

- [ ] **Step 1: Add the three fields to the `CalendarItem` DTO**

In `src/upmovies/public/dto.py`, replace the `CalendarItem` class (lines 122-128) with:

```python
class CalendarItem(BaseModel):
    film_slug: str
    film_title: str
    release_year: int | None
    poster_path: str | None
    release_date: date  # US release date → "YYYY-MM-DD"
    release_type: str  # display bucket: "premiere" | "limited" | "wide"
    director: str | None  # credited director(s), joined with ", "; null when none
    stars: list[str]  # first 3 billed cast names
    genres: list[str]  # up to 3 genre names, ordered by name
```

- [ ] **Step 2: Write the failing tests**

Append these cases to `tests/integration/routers/test_public_calendar.py`:

```python
# ---------------------------------------------------------------------------
# Case 10 — Director, stars (≤3), and genres (≤3) on each row
# ---------------------------------------------------------------------------


async def test_calendar_includes_director_stars_genres(
    client, make_film, add_release_date, attach_credits, attach_genres
):
    film = await make_film(slug="film-enriched", title="Enriched Film")
    await add_release_date(film=film, release_date=_FUTURE, release_type=3)
    await attach_credits(
        film,
        cast=[
            {"id": 1, "name": "First Star", "credit_order": 0},
            {"id": 2, "name": "Second Star", "credit_order": 1},
            {"id": 3, "name": "Third Star", "credit_order": 2},
            {"id": 4, "name": "Fourth Star", "credit_order": 3},
        ],
        crew=[
            {"id": 5, "name": "The Director", "job": "Director", "department": "Directing"},
            {"id": 6, "name": "A Producer", "job": "Producer", "department": "Production"},
        ],
    )
    await attach_genres(film, [(28, "Action"), (18, "Drama"), (12, "Adventure"), (35, "Comedy")])

    resp = await client.get("/calendar")
    assert resp.status_code == 200
    item = next(i for i in resp.json()["items"] if i["film_slug"] == "film-enriched")

    assert item["director"] == "The Director"  # job=Director only; Producer excluded
    assert item["stars"] == ["First Star", "Second Star", "Third Star"]  # capped at 3, in order
    assert len(item["genres"]) == 3  # capped at 3
    assert item["genres"] == ["Action", "Adventure", "Comedy"]  # ordered by name


async def test_calendar_joins_co_directors(
    client, make_film, add_release_date, attach_credits
):
    film = await make_film(slug="film-codir", title="Co-Directed Film")
    await add_release_date(film=film, release_date=_FUTURE, release_type=3)
    await attach_credits(
        film,
        crew=[
            {"id": 10, "name": "Bob Director", "job": "Director", "credit_order": 1},
            {"id": 11, "name": "Ann Director", "job": "Director", "credit_order": 0},
        ],
    )

    item = next(
        i for i in (await client.get("/calendar")).json()["items"] if i["film_slug"] == "film-codir"
    )
    assert item["director"] == "Ann Director, Bob Director"  # credit_order asc → Ann first


async def test_calendar_defaults_when_no_metadata(client, make_film, add_release_date):
    film = await make_film(slug="film-bare", title="Bare Film")
    await add_release_date(film=film, release_date=_FUTURE, release_type=3)

    item = next(
        i for i in (await client.get("/calendar")).json()["items"] if i["film_slug"] == "film-bare"
    )
    assert item["director"] is None
    assert item["stars"] == []
    assert item["genres"] == []
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `task test -- tests/integration/routers/test_public_calendar.py::test_calendar_includes_director_stars_genres tests/integration/routers/test_public_calendar.py::test_calendar_joins_co_directors tests/integration/routers/test_public_calendar.py::test_calendar_defaults_when_no_metadata`

Expected: FAIL — `KeyError: 'director'` (and `'stars'`/`'genres'`) because the response items don't yet carry those keys. (If the loop-scope quirk appears, run `task test -- tests/integration/routers` instead.)

- [ ] **Step 4: Add the three metadata helpers**

In `src/upmovies/public/service.py`, add these module-level async helpers just above `async def get_calendar(...)` (line 603). All imports used (`select`, `func`, `nulls_last`, `UUID`, `FilmCredit`, `Person`, `FilmGenre`, `Genre`, `AsyncSession`) already exist at the top of the file.

```python
async def _calendar_directors(
    session: AsyncSession, film_ids: set[UUID]
) -> dict[UUID, str]:
    """Director name(s) per film, ordered by billing, joined with ', '. Films with none omitted."""
    if not film_ids:
        return {}
    rows = (
        await session.execute(
            select(FilmCredit.film_id, Person.name)
            .join(Person, Person.id == FilmCredit.person_id)
            .where(
                FilmCredit.film_id.in_(film_ids),
                FilmCredit.credit_type == "crew",
                FilmCredit.job == "Director",
            )
            .order_by(
                FilmCredit.film_id,
                nulls_last(FilmCredit.credit_order.asc()),
                Person.name.asc(),
            )
        )
    ).all()
    names_by_film: dict[UUID, list[str]] = {}
    for film_id, name in rows:
        names_by_film.setdefault(film_id, []).append(name)
    return {film_id: ", ".join(names) for film_id, names in names_by_film.items()}


async def _calendar_stars(
    session: AsyncSession, film_ids: set[UUID]
) -> dict[UUID, list[str]]:
    """First 3 billed cast names per film (credit_order asc, nulls last, then name)."""
    if not film_ids:
        return {}
    rn = func.row_number().over(
        partition_by=FilmCredit.film_id,
        order_by=(nulls_last(FilmCredit.credit_order.asc()), Person.name.asc()),
    ).label("rn")
    ranked = (
        select(FilmCredit.film_id.label("film_id"), Person.name.label("name"), rn)
        .join(Person, Person.id == FilmCredit.person_id)
        .where(FilmCredit.film_id.in_(film_ids), FilmCredit.credit_type == "cast")
        .subquery()
    )
    rows = (
        await session.execute(
            select(ranked.c.film_id, ranked.c.name)
            .where(ranked.c.rn <= 3)
            .order_by(ranked.c.film_id, ranked.c.rn)
        )
    ).all()
    stars_by_film: dict[UUID, list[str]] = {}
    for film_id, name in rows:
        stars_by_film.setdefault(film_id, []).append(name)
    return stars_by_film


async def _calendar_genres(
    session: AsyncSession, film_ids: set[UUID]
) -> dict[UUID, list[str]]:
    """Up to 3 genre names per film, ordered by name."""
    if not film_ids:
        return {}
    rows = (
        await session.execute(
            select(FilmGenre.film_id, Genre.name)
            .join(Genre, Genre.id == FilmGenre.genre_id)
            .where(FilmGenre.film_id.in_(film_ids))
            .order_by(FilmGenre.film_id, Genre.name.asc(), Genre.id.asc())
        )
    ).all()
    genres_by_film: dict[UUID, list[str]] = {}
    for film_id, name in rows:
        bucket = genres_by_film.setdefault(film_id, [])
        if len(bucket) < 3:
            bucket.append(name)
    return genres_by_film
```

- [ ] **Step 5: Wire the helpers into `get_calendar`**

In `src/upmovies/public/service.py`, change the calendar row `select(...)` to also fetch `Film.id`, add it to `group_by`, switch the row iteration to attribute access, and populate the new DTO fields. Replace the `rows = (...).all()` block and the `items = [...]` block (lines 630-672) with:

```python
    rows = (
        await session.execute(
            select(
                Film.id.label("film_id"),
                Film.slug.label("slug"),
                Film.title.label("title"),
                Film.release_date.label("film_release_date"),
                Film.poster_path.label("poster_path"),
                rel_day.label("release_date"),
                FilmReleaseDate.release_type.label("release_type"),
            )
            .select_from(FilmReleaseDate)
            .join(Film, Film.id == FilmReleaseDate.film_id)
            .where(*visible, rel_day.in_(select(window.c.d)))
            .group_by(
                Film.id,
                Film.slug,
                Film.title,
                Film.release_date,
                Film.poster_path,
                rel_day,
                FilmReleaseDate.release_type,
            )
            # Within a date, wide (3) before limited (2) → release_type DESC.
            .order_by(
                rel_day.asc(),
                FilmReleaseDate.release_type.desc(),
                nulls_last(Film.popularity.desc()),
                Film.slug.asc(),
            )
        )
    ).all()

    film_ids = {row.film_id for row in rows}
    directors_by_film = await _calendar_directors(session, film_ids)
    stars_by_film = await _calendar_stars(session, film_ids)
    genres_by_film = await _calendar_genres(session, film_ids)

    items = [
        CalendarItem(
            film_slug=row.slug,
            film_title=row.title,
            release_year=_release_year(row.film_release_date),
            poster_path=row.poster_path,
            release_date=row.release_date,
            release_type=_TMDB_TYPE_TO_BUCKET[row.release_type],
            director=directors_by_film.get(row.film_id),
            stars=stars_by_film.get(row.film_id, []),
            genres=genres_by_film.get(row.film_id, []),
        )
        for row in rows
    ]
    return CalendarResponse(items=items, total=total or 0, limit=limit, offset=offset)
```

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `task test -- tests/integration/routers/test_public_calendar.py::test_calendar_includes_director_stars_genres tests/integration/routers/test_public_calendar.py::test_calendar_joins_co_directors tests/integration/routers/test_public_calendar.py::test_calendar_defaults_when_no_metadata`

Expected: 3 passed. (If the loop-scope quirk appears, run `task test -- tests/integration/routers`.)

- [ ] **Step 7: Run the full local CI gate**

Run, and confirm each is green:
```bash
task format        # ruff format (reformats in place)
task lint          # ruff check src tests
task typecheck     # pyright src tests
task test          # full pytest suite
```
Expected: lint/typecheck clean, full suite passes (the existing calendar cases — pagination, dedup, ordering — still pass, confirming no row multiplication).

- [ ] **Step 8: Commit and open the PR**

```bash
git add src/upmovies/public/dto.py src/upmovies/public/service.py tests/integration/routers/test_public_calendar.py
git commit -m "feat: add director, stars, and genres to calendar API"
```
PR title: `feat: add director, stars, and genres to calendar API (NEU-437)`. Then stop and wait for review/merge before starting Task 2.

---

## Task 2: Frontend — poster-left calendar row (own PR, blocked by Task 1)

**Files:**
- Modify: `src/api/types.ts:148-155` (the `CalendarItem` interface)
- Modify: `src/components/calendar/CalendarFilmRow.tsx` (full rewrite)
- Test: `src/components/calendar/CalendarFilmRow.test.tsx` (full rewrite)

**Interfaces:**
- Consumes: the Task 1 API fields `director: string | null`, `stars: string[]`, `genres: string[]`; existing helper `posterUrl(path: string | null, size: string): string | null` from `src/lib/poster.ts`.
- Produces: an enriched `CalendarFilmRow`. No change to `getCalendar` (`src/api/public.ts`) — it casts the JSON to `CalendarResponse`, so the type change is sufficient.

- [ ] **Step 1: Add the three fields to the `CalendarItem` type**

In `src/api/types.ts`, replace the `CalendarItem` interface (lines 148-155) with:

```ts
export interface CalendarItem {
  film_slug: string;
  film_title: string;
  release_year: number | null;
  poster_path: string | null; // raw TMDB path; FE builds the URL via posterUrl()
  release_date: string; // "YYYY-MM-DD" (US date)
  release_type: string; // bucket: "premiere" | "limited" | "wide" — rendered via releaseBucketLabel
  director: string | null; // credited director(s), joined with ", "
  stars: string[]; // first 3 billed cast names
  genres: string[]; // up to 3 genre names
}
```

- [ ] **Step 2: Rewrite the component test (failing)**

Replace the entire contents of `src/components/calendar/CalendarFilmRow.test.tsx` with:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { CalendarFilmRow } from "@/components/calendar/CalendarFilmRow";
import type { CalendarItem } from "@/api/types";

const item: CalendarItem = {
  film_slug: "the-odyssey-2026",
  film_title: "The Odyssey",
  release_year: 2026,
  poster_path: "/odyssey.jpg",
  release_date: "2026-07-04",
  release_type: "wide",
  director: "Christopher Nolan",
  stars: ["Matt Damon", "Tom Holland", "Zendaya"],
  genres: ["Adventure", "Drama"],
};

function renderRow(overrides: Partial<CalendarItem> = {}) {
  render(
    <MemoryRouter>
      <CalendarFilmRow item={{ ...item, ...overrides }} />
    </MemoryRouter>,
  );
}

describe("CalendarFilmRow", () => {
  it("links the row and shows title, year, director, stars, and genres", () => {
    renderRow();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/film/the-odyssey-2026");
    expect(screen.getByText("The Odyssey")).toBeInTheDocument();
    expect(screen.getByText("(2026)")).toBeInTheDocument();
    expect(screen.getByText("Dir. Christopher Nolan")).toBeInTheDocument();
    expect(screen.getByText("Matt Damon · Tom Holland · Zendaya")).toBeInTheDocument();
    expect(screen.getByText("Adventure · Drama")).toBeInTheDocument();
  });

  it("renders the poster thumbnail from poster_path", () => {
    renderRow();
    expect(screen.getByRole("img").getAttribute("src")).toContain("/w92/odyssey.jpg");
  });

  it("renders a placeholder (no img) when poster_path is null", () => {
    renderRow({ poster_path: null });
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("omits year, director, stars, and genres when absent", () => {
    renderRow({ release_year: null, director: null, stars: [], genres: [] });
    expect(screen.queryByText(/\(\d{4}\)/)).toBeNull();
    expect(screen.queryByText(/^Dir\./)).toBeNull();
    expect(screen.queryByText(/·/)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `task test -- src/components/calendar/CalendarFilmRow.test.tsx`
Expected: FAIL — the current component renders neither the director/stars/genres text nor an `<img>`, so the new assertions fail.

- [ ] **Step 4: Rewrite the component**

Replace the entire contents of `src/components/calendar/CalendarFilmRow.tsx` with:

```tsx
import { Link } from "react-router";
import { posterUrl } from "@/lib/poster";
import type { CalendarItem } from "@/api/types";

/** One calendar row: poster thumbnail + title/year, director, top-billed stars, and genres.
 *  The whole row links to /film/{slug}; zebra-striped within its release-type group. */
export function CalendarFilmRow({ item }: { item: CalendarItem }) {
  const poster = posterUrl(item.poster_path, "w92");
  return (
    <Link
      to={`/film/${item.film_slug}`}
      className="flex gap-3 rounded px-2 py-2 odd:bg-muted/40 hover:bg-muted"
    >
      {poster ? (
        <img
          src={poster}
          alt={item.film_title}
          className="h-[72px] w-12 flex-none rounded object-cover"
        />
      ) : (
        <div className="h-[72px] w-12 flex-none rounded bg-muted" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1 text-sm">
        <div className="truncate font-medium">
          {item.film_title}
          {item.release_year != null && (
            <span className="font-normal text-muted-foreground"> ({item.release_year})</span>
          )}
        </div>
        {item.director && (
          <div className="truncate text-muted-foreground">Dir. {item.director}</div>
        )}
        {item.stars.length > 0 && (
          <div className="truncate text-muted-foreground">{item.stars.join(" · ")}</div>
        )}
        {item.genres.length > 0 && (
          <div className="truncate text-muted-foreground">{item.genres.join(" · ")}</div>
        )}
      </div>
    </Link>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `task test -- src/components/calendar/CalendarFilmRow.test.tsx`
Expected: 4 passed.

- [ ] **Step 6: Run the full local CI gate**

Run, and confirm each is green:
```bash
task format        # prettier — format only the touched files
task lint          # eslint src --max-warnings 0
task typecheck     # tsc --noEmit
task test          # full vitest run (calendar route test still passes)
```
Expected: zero eslint warnings, tsc clean, full vitest suite passes.

- [ ] **Step 7: Commit and open the PR**

```bash
git add src/api/types.ts src/components/calendar/CalendarFilmRow.tsx src/components/calendar/CalendarFilmRow.test.tsx
git commit -m "feat: enrich calendar rows with poster, director, stars, genres (NEU-437)"
```
PR title: `feat: enrich calendar rows with poster, director, stars, genres (NEU-437)`. PR body keeps the `🤖 Generated with Claude Code` footer.

---

## Manual verification (after both PRs merge)

Run the frontend against the dev API (`https://api.upmovies.localhost`) and open `/calendar`. Confirm each row shows a poster thumbnail on the left with title (year), `Dir. …`, up to three star names, and up to three genres stacked to the right; rows for films missing any of those fields degrade gracefully (placeholder box / omitted lines) without breaking alignment.
