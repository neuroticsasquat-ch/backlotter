# Film page + calendar polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface full crew, plot, and external links on the film page, and group the release calendar by year → month → day.

**Architecture:** Two repos under the `upcoming-movies` umbrella. Four user stories (NEU-410/411/412/413); the two cross-stack stories (411, 413) are split into a backend task and a frontend task. Each **task below = one PR = one Linear ticket**. No database migration is needed — every column read (`Film.imdb_id`, `Film.tmdb_id`, `Film.overview`, `FilmCredit.job`/`.department`) already exists.

**Tech Stack:** Backend — FastAPI, SQLAlchemy 2 async, Pydantic v2, pytest. Frontend — React + TS, react-router, Tailwind v4, Vitest + Testing Library.

## Global Constraints

- **Container-only.** Never run `pytest`/`ruff`/`pyright`/`pnpm`/`vitest`/`tsc`/`eslint` on the host. Use `task` targets, which `docker compose exec` into the running container. Keep the container up.
- **Backend "done" gate:** `task test`, `task lint`, `task typecheck` all green; run `task format` (ruff also reformats).
- **Frontend "done" gate:** `task test`, `task lint` (ESLint at **zero warnings** — unused imports fail), `task typecheck` green; `task format` (Prettier) on changed files only.
- **TDD always:** write the failing test first, watch it fail, then implement.
- **Type hints (Py):** modern `X | None`; no `from __future__ import annotations`. Line length 100.
- **Per-PR execution:** each task is its own PR off a work branch (Linear gives the branch name per ticket). **Do not commit inside steps** — the "done" step of each task is the green CI gate; the user commits/opens the PR and signals before the next task starts. The FE tasks for 411/413 depend on their BE task's contract; merge BE + FE of a split story together (the BE change to NEU-413 removes `directors` from the API).

---

## Task 1 — NEU-413 BE: full crew in the film-detail API

**Files:**
- Modify: `upcoming-movies-backend/src/upmovies/public/dto.py` (add `CrewMemberOut`, swap `directors` → `crew` on `FilmDetailResponse`)
- Modify: `upcoming-movies-backend/src/upmovies/public/service.py:230-430` (`get_film_detail` — replace the directors query with a full-crew query + ordering)
- Modify: `upcoming-movies-backend/tests/fixtures/public.py:254-264` (let `attach_credits` crew entries carry `credit_order`)
- Test: `upcoming-movies-backend/tests/integration/routers/test_public_films.py` (update the credits section ~lines 768-852)

**Interfaces:**
- Produces (DTO consumed by Task 3):
  ```python
  class CrewMemberOut(BaseModel):
      name: str
      job: str | None
      department: str | None
  # FilmDetailResponse gains:  crew: list[CrewMemberOut] = []
  # FilmDetailResponse LOSES:  directors: list[str]
  ```
- Crew order: department priority → department name (tiebreak for unknown depts) → job (alpha) → credit_order (nulls last) → name.

> **Spec deviation to confirm at review:** the spec's `CrewMemberOut` listed `profile_path` and `credit_order`; both are dropped here because the FE crew block renders no photos and ordering is applied server-side. `department` is kept (cheap, enables future regrouping). Flag this to the user.

- [ ] **Step 1: Extend the `attach_credits` fixture to carry crew `credit_order`**

In `tests/fixtures/public.py`, the crew loop (currently lines 254-264) becomes:

```python
        # Insert FilmCredit rows for crew members
        for entry in crew:
            session.add(
                FilmCredit(
                    credit_id=f"crew-{film.id}-{entry['id']}-{entry.get('job', 'unknown')}",
                    film_id=film.id,
                    person_id=entry["id"],
                    credit_type="crew",
                    job=entry.get("job"),
                    department=entry.get("department", "Directing"),
                    credit_order=entry.get("credit_order"),
                )
            )
```

Also update the docstring line for crew entries:

```python
        crew entries: {id, name, job, department, credit_order}
```

- [ ] **Step 2: Replace the directors tests with crew tests (write them failing)**

In `tests/integration/routers/test_public_films.py`, **delete** `test_film_detail_directors` (lines ~819-839) and **replace** it with the two tests below. Also **edit** `test_film_detail_no_credits_graceful` (lines ~842-851) to assert on `crew` instead of `directors`.

```python
async def test_film_detail_crew_grouped_orderable(client, make_film, add_event, attach_credits):
    """The full crew is returned (not just directors), ordered by department priority then job."""
    film = await make_film(slug="crew-2026", title="Crew Film")
    await add_event(film=film, summary="Event.")
    await attach_credits(
        film,
        crew=[
            {"id": 3001, "name": "Editor Person", "job": "Editor", "department": "Editing"},
            {"id": 3002, "name": "Writer Person", "job": "Screenplay", "department": "Writing"},
            {"id": 3003, "name": "Director Person", "job": "Director", "department": "Directing"},
            {"id": 3004, "name": "Producer Person", "job": "Producer", "department": "Production"},
        ],
    )

    r = await client.get("/films/crew-2026")
    assert r.status_code == 200
    body = r.json()
    assert "directors" not in body  # replaced by crew
    crew = body["crew"]
    # Department priority: Directing → Writing → Production → Editing
    assert [c["job"] for c in crew] == ["Director", "Screenplay", "Producer", "Editor"]
    assert crew[0] == {"name": "Director Person", "job": "Director", "department": "Directing"}


async def test_film_detail_crew_orders_within_job_by_credit_order(
    client, make_film, add_event, attach_credits
):
    """Within one job, people order by credit_order asc (nulls last), then name."""
    film = await make_film(slug="crew-order-2026", title="Crew Order Film")
    await add_event(film=film, summary="Event.")
    await attach_credits(
        film,
        crew=[
            {"id": 4001, "name": "Bravo Producer", "job": "Producer",
             "department": "Production", "credit_order": 2},
            {"id": 4002, "name": "Alpha Producer", "job": "Producer",
             "department": "Production", "credit_order": 1},
            {"id": 4003, "name": "Zulu Producer", "job": "Producer",
             "department": "Production", "credit_order": None},
        ],
    )

    crew = (await client.get("/films/crew-order-2026")).json()["crew"]
    assert [c["name"] for c in crew] == ["Alpha Producer", "Bravo Producer", "Zulu Producer"]
```

Edit `test_film_detail_no_credits_graceful`:

```python
async def test_film_detail_no_credits_graceful(client, make_film, add_event):
    """A film with no credits returns cast=[] and crew=[] with status 200."""
    film = await make_film(slug="no-credits-2026", title="No Credits Film")
    await add_event(film=film, summary="Event.")

    r = await client.get("/films/no-credits-2026")
    assert r.status_code == 200
    body = r.json()
    assert body["cast"] == []
    assert body["crew"] == []
```

- [ ] **Step 3: Run the tests, verify they FAIL**

Run: `task test -- tests/integration/routers/test_public_films.py`
Expected: FAIL — `crew` not in response / `CrewMemberOut` undefined.

- [ ] **Step 4: Add `CrewMemberOut` and swap the DTO field**

In `src/upmovies/public/dto.py`, add after `CastMemberOut` (line ~53):

```python
class CrewMemberOut(BaseModel):
    name: str
    job: str | None
    department: str | None
```

In `FilmDetailResponse`, replace `directors: list[str] = []` (line 76) with:

```python
    crew: list[CrewMemberOut] = []
```

- [ ] **Step 5: Implement the crew query + ordering in the service**

In `src/upmovies/public/service.py`, add `CrewMemberOut` to the dto import block (lines 35-50). Add this module-level block near the other constants (after line 58):

```python
_CREW_DEPARTMENT_ORDER = (
    "Directing",
    "Writing",
    "Production",
    "Camera",
    "Editing",
    "Sound",
    "Art",
    "Costume & Make-Up",
    "Visual Effects",
    "Lighting",
    "Crew",
)
_DEPT_PRIORITY = {name: i for i, name in enumerate(_CREW_DEPARTMENT_ORDER)}
_DEPT_UNKNOWN = len(_CREW_DEPARTMENT_ORDER)


def _crew_sort_key(row: Any) -> tuple:
    """Order crew by department priority, then job (alpha), then credit_order (nulls last),
    then name. Unknown departments sort after all known ones, alphabetically by name."""
    dept = row.department or ""
    return (
        _DEPT_PRIORITY.get(dept, _DEPT_UNKNOWN),
        dept,
        row.job or "",
        row.credit_order is None,
        row.credit_order or 0,
        row.name,
    )
```

In `get_film_detail`, replace the `director_rows` / `directors_out` block (lines 394-406) with:

```python
    crew_rows = (
        await session.execute(
            select(
                Person.name,
                FilmCredit.job,
                FilmCredit.department,
                FilmCredit.credit_order,
            )
            .join(FilmCredit, FilmCredit.person_id == Person.id)
            .where(FilmCredit.film_id == film.id, FilmCredit.credit_type == "crew")
        )
    ).all()
    crew_out = [
        CrewMemberOut(name=r.name, job=r.job, department=r.department)
        for r in sorted(crew_rows, key=_crew_sort_key)
    ]
```

In the `return FilmDetailResponse(...)`, replace `directors=directors_out,` (line 429) with:

```python
        crew=crew_out,
```

- [ ] **Step 6: Run the tests, verify they PASS**

Run: `task test -- tests/integration/routers/test_public_films.py`
Expected: PASS.

- [ ] **Step 7: Full backend gate**

Run: `task test` then `task lint` then `task typecheck` then `task format`.
Expected: all green. (`task test` confirms no other test referenced the removed `directors` field.)

---

## Task 2 — NEU-411 BE: expose `imdb_id` and `tmdb_id`

**Files:**
- Modify: `upcoming-movies-backend/src/upmovies/public/dto.py` (`FilmDetailResponse`)
- Modify: `upcoming-movies-backend/src/upmovies/public/service.py` (`get_film_detail` return)
- Test: `upcoming-movies-backend/tests/integration/routers/test_public_films.py`

**Interfaces:**
- Produces (consumed by Task 4): `FilmDetailResponse` gains `imdb_id: str | None = None` and `tmdb_id: int`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/routers/test_public_films.py` (the `make_film` fixture sets `tmdb_id = 1000 + n`, so assert it is a positive int, not a fixed value):

```python
async def test_detail_exposes_external_ids(client, make_film, add_event, session):
    film = await make_film(slug="ext-ids-2026", title="External IDs Film")
    film.imdb_id = "tt1234567"
    session.add(film)
    await session.commit()
    await add_event(film=film, summary="Event.")

    body = (await client.get("/films/ext-ids-2026")).json()
    assert body["imdb_id"] == "tt1234567"
    assert isinstance(body["tmdb_id"], int)
    assert body["tmdb_id"] > 0


async def test_detail_external_ids_null_imdb(client, make_film, add_event):
    film = await make_film(slug="ext-null-2026", title="No IMDb Film")  # imdb_id defaults to None
    await add_event(film=film, summary="Event.")

    body = (await client.get("/films/ext-null-2026")).json()
    assert body["imdb_id"] is None
    assert isinstance(body["tmdb_id"], int)
```

- [ ] **Step 2: Run the tests, verify they FAIL**

Run: `task test -- tests/integration/routers/test_public_films.py -k external`
Expected: FAIL — `imdb_id` / `tmdb_id` not in response.

- [ ] **Step 3: Add the DTO fields**

In `src/upmovies/public/dto.py`, in `FilmDetailResponse`, add after `slug`/`title` (around line 57):

```python
    tmdb_id: int
    imdb_id: str | None = None
```

- [ ] **Step 4: Populate them in the service**

In `src/upmovies/public/service.py`, in the `return FilmDetailResponse(...)` add (next to `slug=film.slug,`):

```python
        tmdb_id=film.tmdb_id,
        imdb_id=film.imdb_id,
```

- [ ] **Step 5: Run the tests, verify they PASS**

Run: `task test -- tests/integration/routers/test_public_films.py -k external`
Expected: PASS.

- [ ] **Step 6: Full backend gate**

Run: `task test`, `task lint`, `task typecheck`, `task format` — all green.

---

## Task 3 — NEU-413 FE: crew block + restructured director/writer billing

**Files:**
- Modify: `upcoming-movies-frontend/src/api/types.ts` (add `CrewMember`, swap `directors` → `crew` on `FilmDetail`)
- Create: `upcoming-movies-frontend/src/lib/crew-groups.ts` (+ adjacency grouping by job)
- Create: `upcoming-movies-frontend/src/lib/crew-groups.test.ts`
- Create: `upcoming-movies-frontend/src/components/film/FilmCrew.tsx`
- Create: `upcoming-movies-frontend/src/components/film/FilmCrew.test.tsx`
- Modify: `upcoming-movies-frontend/src/components/film/FilmHeader.tsx` (top billing from `crew`)
- Modify: `upcoming-movies-frontend/src/components/film/FilmHeader.test.tsx` (fixture + director/writer tests)
- Modify: `upcoming-movies-frontend/src/routes/film.tsx` (render `<FilmCrew>`)

**Interfaces:**
- Consumes: `FilmDetail.crew: CrewMember[]` from Task 1 (`{ name, job, department }`).
- Produces:
  ```ts
  export interface CrewMember { name: string; job: string | null; department: string | null }
  // groupCrewByJob(crew): { job: string; people: CrewMember[] }[]   (null job → "Crew")
  ```

- [ ] **Step 1: Update the `FilmDetail` type**

In `src/api/types.ts`, add after the `CastMember` interface (line ~82):

```ts
export interface CrewMember {
  name: string;
  job: string | null;
  department: string | null;
}
```

In `FilmDetail`, replace `directors: string[];` (line 105) with:

```ts
  crew: CrewMember[];
```

- [ ] **Step 2: Write the failing crew-grouping test**

Create `src/lib/crew-groups.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { groupCrewByJob } from "@/lib/crew-groups";
import type { CrewMember } from "@/api/types";

function c(name: string, job: string | null): CrewMember {
  return { name, job, department: null };
}

describe("groupCrewByJob", () => {
  it("returns an empty array for no crew", () => {
    expect(groupCrewByJob([])).toEqual([]);
  });

  it("groups adjacent same-job members into one group, preserving input order", () => {
    const groups = groupCrewByJob([
      c("Greta Gerwig", "Director"),
      c("Greta Gerwig", "Screenplay"),
      c("Noah Baumbach", "Screenplay"),
      c("David Heyman", "Producer"),
    ]);
    expect(groups.map((g) => g.job)).toEqual(["Director", "Screenplay", "Producer"]);
    expect(groups[1].people.map((p) => p.name)).toEqual(["Greta Gerwig", "Noah Baumbach"]);
  });

  it("labels a null job as 'Crew'", () => {
    const groups = groupCrewByJob([c("Anon Person", null)]);
    expect(groups[0].job).toBe("Crew");
  });
});
```

- [ ] **Step 3: Run it, verify it FAILS**

Run: `task test -- src/lib/crew-groups.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `groupCrewByJob`**

Create `src/lib/crew-groups.ts`:

```ts
import type { CrewMember } from "@/api/types";

export interface CrewJobGroup {
  job: string; // job title label; null jobs collapse to "Crew"
  people: CrewMember[];
}

/**
 * Group a backend-ordered crew list (department priority → job → credit_order) into per-job
 * sections via an adjacency walk — same approach as groupByReleaseDate. No sorting, so SSR and
 * client output match. A null job is labeled "Crew".
 */
export function groupCrewByJob(crew: CrewMember[]): CrewJobGroup[] {
  const groups: CrewJobGroup[] = [];
  for (const member of crew) {
    const job = member.job ?? "Crew";
    const last = groups[groups.length - 1];
    if (!last || last.job !== job) {
      groups.push({ job, people: [member] });
    } else {
      last.people.push(member);
    }
  }
  return groups;
}
```

- [ ] **Step 5: Run it, verify it PASSES**

Run: `task test -- src/lib/crew-groups.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing `FilmCrew` test**

Create `src/components/film/FilmCrew.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FilmCrew } from "@/components/film/FilmCrew";
import type { CrewMember } from "@/api/types";

const crew: CrewMember[] = [
  { name: "Greta Gerwig", job: "Director", department: "Directing" },
  { name: "Greta Gerwig", job: "Screenplay", department: "Writing" },
  { name: "Noah Baumbach", job: "Screenplay", department: "Writing" },
];

describe("FilmCrew", () => {
  it("renders the Crew heading with a count", () => {
    render(<FilmCrew crew={crew} />);
    expect(screen.getByRole("heading", { name: "Crew" })).toBeInTheDocument();
    expect(screen.getByText("(3)")).toBeInTheDocument();
  });

  it("renders a job label with its people listed below", () => {
    render(<FilmCrew crew={crew} />);
    expect(screen.getByText("Director")).toBeInTheDocument();
    // "Screenplay" job label groups both writers
    expect(screen.getByText("Screenplay")).toBeInTheDocument();
    expect(screen.getByText("Noah Baumbach")).toBeInTheDocument();
  });

  it("renders nothing when crew is empty", () => {
    const { container } = render(<FilmCrew crew={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 7: Run it, verify it FAILS**

Run: `task test -- src/components/film/FilmCrew.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 8: Implement `FilmCrew`**

Create `src/components/film/FilmCrew.tsx`:

```tsx
import type { CrewMember } from "@/api/types";
import { groupCrewByJob } from "@/lib/crew-groups";
import { CollapsibleSection } from "./CollapsibleSection";

/** Full crew: a collapsed disclosure (closed by default) that expands to job-title groups,
 *  each a label with the people who share that title listed below it. Mirrors the cast block.
 *  Crew arrives department/job-ordered from the backend; we adjacency-group it by job. */
export function FilmCrew({ crew }: { crew: CrewMember[] }) {
  if (crew.length === 0) return null;
  const groups = groupCrewByJob(crew);

  return (
    <CollapsibleSection title="Crew" count={crew.length}>
      <div className="space-y-2">
        {groups.map((group) => (
          <div key={group.job}>
            <h3 className="text-xs font-semibold text-muted-foreground">{group.job}</h3>
            <ul>
              {group.people.map((person, i) => (
                <li
                  key={`${person.name}-${i}`}
                  className="rounded px-2 py-0.5 text-sm font-medium odd:bg-muted/40"
                >
                  {person.name}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </CollapsibleSection>
  );
}
```

- [ ] **Step 9: Run it, verify it PASSES**

Run: `task test -- src/components/film/FilmCrew.test.tsx`
Expected: PASS.

- [ ] **Step 10: Update the `FilmHeader` test fixture + billing tests (write failing)**

In `src/components/film/FilmHeader.test.tsx`, replace `directors: ["Christopher Nolan"],` in the fixture (line 35) with:

```ts
  crew: [
    { name: "Christopher Nolan", job: "Director", department: "Directing" },
    { name: "Christopher Nolan", job: "Screenplay", department: "Writing" },
    { name: "Jonathan Nolan", job: "Story", department: "Writing" },
  ],
```

Replace the existing director test (lines 74-78) with:

```ts
  it("renders Director / Screenplay / Story as separate labels from crew", () => {
    render(<FilmHeader film={film} />);
    expect(screen.getByText("Director")).toBeInTheDocument();
    expect(screen.getByText("Screenplay")).toBeInTheDocument();
    expect(screen.getByText("Story")).toBeInTheDocument();
    // Director name appears (Christopher Nolan is both Director and Screenplay → listed in each)
    expect(screen.getAllByText("Christopher Nolan").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Jonathan Nolan")).toBeInTheDocument();
  });

  it("omits a billing label with no people (no Writer credit here)", () => {
    render(<FilmHeader film={film} />);
    expect(screen.queryByText("Writer")).not.toBeInTheDocument();
  });
```

- [ ] **Step 11: Run it, verify it FAILS**

Run: `task test -- src/components/film/FilmHeader.test.tsx`
Expected: FAIL — `film.directors` is undefined / labels missing.

- [ ] **Step 12: Rework `FilmHeader` billing to derive from crew**

In `src/components/film/FilmHeader.tsx`, inside the component (after `const rating = ...`, line 12) add:

```tsx
  const billing: [string, string[]][] = (
    [
      ["Director", "Director"],
      ["Screenplay", "Screenplay"],
      ["Writer", "Writer"],
      ["Story", "Story"],
    ] as const
  )
    .map(
      ([label, job]) =>
        [label, film.crew.filter((c) => c.job === job).map((c) => c.name)] as [string, string[]],
    )
    .filter(([, names]) => names.length > 0);
```

Replace the `film.directors` block (lines 39-44) with:

```tsx
        {billing.map(([label, names]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>
              {names.map((name) => (
                <div key={name}>{name}</div>
              ))}
            </dd>
          </div>
        ))}
```

Note: `className="contents"` keeps the wrapper transparent to the two-column `<dl>` grid.

- [ ] **Step 13: Run the FilmHeader test, verify it PASSES**

Run: `task test -- src/components/film/FilmHeader.test.tsx`
Expected: PASS.

- [ ] **Step 14: Render `<FilmCrew>` on the film route**

In `src/routes/film.tsx`, add the import after the `FilmCredits` import (line 10):

```tsx
import { FilmCrew } from "@/components/film/FilmCrew";
```

In the JSX (lines 53-58), insert `<FilmCrew>` right after `<FilmCredits>`:

```tsx
        <FilmCredits cast={film.cast} />
        <FilmCrew crew={film.crew} />
```

- [ ] **Step 15: Fix any other `directors` references + full FE gate**

Run: `task typecheck` first — it flags every remaining `film.directors` use (e.g. other test fixtures, MSW handlers in `src/test/`). Update each to the `crew` shape. Then run `task test`, `task lint`, `task format`.
Expected: all green, zero ESLint warnings.

---

## Task 4 — NEU-411 FE: IMDb / TMDB link icons

**Files:**
- Modify: `upcoming-movies-frontend/src/api/types.ts` (`FilmDetail` gains `imdb_id`, `tmdb_id`)
- Create: `upcoming-movies-frontend/src/components/film/ExternalLinks.tsx`
- Create: `upcoming-movies-frontend/src/components/film/ExternalLinks.test.tsx`
- Modify: `upcoming-movies-frontend/src/components/film/FilmHeader.tsx` (render `<ExternalLinks>`)
- Modify: `upcoming-movies-frontend/src/components/film/FilmHeader.test.tsx` (fixture gains ids)

**Interfaces:**
- Consumes: `FilmDetail.imdb_id: string | null`, `FilmDetail.tmdb_id: number` from Task 2.

- [ ] **Step 1: Update the `FilmDetail` type**

In `src/api/types.ts`, in `FilmDetail`, add after `slug`/`title` (line ~86):

```ts
  tmdb_id: number;
  imdb_id: string | null;
```

- [ ] **Step 2: Write the failing `ExternalLinks` test**

Create `src/components/film/ExternalLinks.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExternalLinks } from "@/components/film/ExternalLinks";

describe("ExternalLinks", () => {
  it("links TMDB by numeric id and IMDb by imdb id, opening in a new tab", () => {
    render(<ExternalLinks tmdbId={12345} imdbId="tt1234567" />);
    const tmdb = screen.getByRole("link", { name: /tmdb/i });
    const imdb = screen.getByRole("link", { name: /imdb/i });
    expect(tmdb).toHaveAttribute("href", "https://www.themoviedb.org/movie/12345");
    expect(imdb).toHaveAttribute("href", "https://www.imdb.com/title/tt1234567/");
    expect(tmdb).toHaveAttribute("target", "_blank");
    expect(tmdb).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("omits the IMDb link when imdbId is null", () => {
    render(<ExternalLinks tmdbId={12345} imdbId={null} />);
    expect(screen.queryByRole("link", { name: /imdb/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /tmdb/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it, verify it FAILS**

Run: `task test -- src/components/film/ExternalLinks.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `ExternalLinks`**

Create `src/components/film/ExternalLinks.tsx` (chip styling mirrors `SourceLinks`):

```tsx
/** Outbound links to the film on IMDb and TMDB, shown as clearly-clickable chips. The IMDb
 *  chip is omitted when the film has no imdb_id. */
export function ExternalLinks({ tmdbId, imdbId }: { tmdbId: number; imdbId: string | null }) {
  const chip =
    "inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-foreground transition-colors hover:border-blue-500 hover:bg-blue-500/10 hover:text-blue-400";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {imdbId && (
        <a
          href={`https://www.imdb.com/title/${imdbId}/`}
          target="_blank"
          rel="noopener noreferrer"
          className={chip}
        >
          IMDb
        </a>
      )}
      <a
        href={`https://www.themoviedb.org/movie/${tmdbId}`}
        target="_blank"
        rel="noopener noreferrer"
        className={chip}
      >
        TMDB
      </a>
    </div>
  );
}
```

- [ ] **Step 5: Run it, verify it PASSES**

Run: `task test -- src/components/film/ExternalLinks.test.tsx`
Expected: PASS.

- [ ] **Step 6: Render the links in the header (write failing test first)**

In `src/components/film/FilmHeader.test.tsx`, add `tmdb_id: 603,` and `imdb_id: "tt0133093",` to the fixture object, then add:

```ts
  it("renders the IMDb and TMDB links in the header", () => {
    render(<FilmHeader film={film} />);
    expect(screen.getByRole("link", { name: /imdb/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /tmdb/i })).toBeInTheDocument();
  });
```

Run: `task test -- src/components/film/FilmHeader.test.tsx` → FAIL.

- [ ] **Step 7: Add `<ExternalLinks>` to `FilmHeader`**

In `src/components/film/FilmHeader.tsx`, import it (line ~4):

```tsx
import { ExternalLinks } from "./ExternalLinks";
```

Render it just below the closing `</dl>` (after line 81), inside the `<header>`:

```tsx
      <div className="mt-4">
        <ExternalLinks tmdbId={film.tmdb_id} imdbId={film.imdb_id} />
      </div>
```

- [ ] **Step 8: Run it, verify it PASSES, then full FE gate**

Run: `task test -- src/components/film/FilmHeader.test.tsx` → PASS.
Then `task typecheck` (flags any other `FilmDetail` fixtures missing `tmdb_id` — update them), `task test`, `task lint`, `task format`. All green.

---

## Task 5 — NEU-412 FE: collapsed plot block

**Files:**
- Create: `upcoming-movies-frontend/src/components/film/FilmPlot.tsx`
- Create: `upcoming-movies-frontend/src/components/film/FilmPlot.test.tsx`
- Modify: `upcoming-movies-frontend/src/routes/film.tsx` (render `<FilmPlot>` first in the stack)

**Interfaces:**
- Consumes: `FilmDetail.overview: string | null` (already in the type and the API).

- [ ] **Step 1: Write the failing test**

Create `src/components/film/FilmPlot.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FilmPlot } from "@/components/film/FilmPlot";

describe("FilmPlot", () => {
  it("renders the Plot heading and the overview text", () => {
    render(<FilmPlot overview="A gripping story unfolds." />);
    expect(screen.getByRole("heading", { name: "Plot" })).toBeInTheDocument();
    expect(screen.getByText("A gripping story unfolds.")).toBeInTheDocument();
  });

  it("renders nothing when overview is null", () => {
    const { container } = render(<FilmPlot overview={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when overview is an empty string", () => {
    const { container } = render(<FilmPlot overview="" />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run it, verify it FAILS**

Run: `task test -- src/components/film/FilmPlot.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `FilmPlot`**

Create `src/components/film/FilmPlot.tsx`:

```tsx
import { CollapsibleSection } from "./CollapsibleSection";

/** Plot summary: a collapsed disclosure (closed by default) that expands to the film's
 *  overview text. Hidden entirely when there is no overview. */
export function FilmPlot({ overview }: { overview: string | null }) {
  if (!overview) return null;

  return (
    <CollapsibleSection title="Plot" railed={false}>
      <p className="px-2 text-sm leading-relaxed text-foreground">{overview}</p>
    </CollapsibleSection>
  );
}
```

- [ ] **Step 4: Run it, verify it PASSES**

Run: `task test -- src/components/film/FilmPlot.test.tsx`
Expected: PASS.

- [ ] **Step 5: Render `<FilmPlot>` first in the film route stack**

In `src/routes/film.tsx`, import it (after line 9):

```tsx
import { FilmPlot } from "@/components/film/FilmPlot";
```

Place it first inside the stack `<div className="mt-6">`, before `<ReleaseDates>` is fine, but per the agreed order Plot leads the collapsibles — put it right after `<ReleaseDates>`:

```tsx
        <ReleaseDates dates={film.release_dates} />
        <FilmPlot overview={film.overview} />
        <FilmCredits cast={film.cast} />
```

- [ ] **Step 6: Full FE gate**

Run: `task test`, `task lint`, `task typecheck`, `task format`. All green.

---

## Task 6 — NEU-410 FE: group the calendar by year → month → day

**Files:**
- Modify: `upcoming-movies-frontend/src/lib/calendar-groups.ts` (add `nestByYearMonth`)
- Modify: `upcoming-movies-frontend/src/lib/calendar-groups.test.ts` (tests for nesting)
- Modify: `upcoming-movies-frontend/src/routes/calendar.tsx` (render nested with sticky headers; keep date-based pagination)
- Modify: `upcoming-movies-frontend/src/routes/calendar.test.tsx` (add year/month heading assertions — keep existing cases)

**Interfaces:**
- Produces:
  ```ts
  export interface CalendarMonthGroup { monthKey: string; heading: string; days: CalendarDateGroup[] }
  export interface CalendarYearGroup { year: string; months: CalendarMonthGroup[] }
  // nestByYearMonth(dateGroups: CalendarDateGroup[]): CalendarYearGroup[]
  ```
- Pagination stays by distinct date: offset = `groupByReleaseDate(items).length` (unchanged semantics).

- [ ] **Step 1: Write the failing nesting tests**

Append to `src/lib/calendar-groups.test.ts`:

```ts
import { groupByReleaseDate as _g, nestByYearMonth } from "@/lib/calendar-groups";

describe("nestByYearMonth", () => {
  it("returns an empty array for no date groups", () => {
    expect(nestByYearMonth([])).toEqual([]);
  });

  it("nests day groups under month (named) and year, preserving order", () => {
    const dayGroups = _g([
      item("a", "2026-06-12", "wide"),
      item("b", "2026-06-17", "wide"),
      item("c", "2026-07-01", "wide"),
      item("d", "2027-01-05", "wide"),
    ]);
    const years = nestByYearMonth(dayGroups);
    expect(years.map((y) => y.year)).toEqual(["2026", "2027"]);
    expect(years[0].months.map((m) => m.heading)).toEqual(["June", "July"]);
    expect(years[0].months[0].days.map((d) => d.dateKey)).toEqual(["2026-06-12", "2026-06-17"]);
    expect(years[1].months[0].heading).toBe("January");
    expect(years[1].months[0].monthKey).toBe("2027-01");
  });
});
```

- [ ] **Step 2: Run it, verify it FAILS**

Run: `task test -- src/lib/calendar-groups.test.ts`
Expected: FAIL — `nestByYearMonth` is not exported.

- [ ] **Step 3: Implement `nestByYearMonth`**

Append to `src/lib/calendar-groups.ts`:

```ts
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export interface CalendarMonthGroup {
  monthKey: string; // "YYYY-MM" — stable React key
  heading: string; // month name, e.g. "June"
  days: CalendarDateGroup[];
}

export interface CalendarYearGroup {
  year: string; // "YYYY" — heading + stable React key
  months: CalendarMonthGroup[];
}

/**
 * Nest already-ordered per-date groups (from groupByReleaseDate) under month and year via an
 * adjacency walk. Year/month are parsed straight off the "YYYY-MM-DD" dateKey string (no Date),
 * so SSR and client output match. Order is preserved (soonest-first).
 */
export function nestByYearMonth(dateGroups: CalendarDateGroup[]): CalendarYearGroup[] {
  const years: CalendarYearGroup[] = [];
  for (const day of dateGroups) {
    const year = day.dateKey.slice(0, 4);
    const monthKey = day.dateKey.slice(0, 7);
    const monthIdx = Number(day.dateKey.slice(5, 7)) - 1;

    let lastYear = years[years.length - 1];
    if (!lastYear || lastYear.year !== year) {
      lastYear = { year, months: [] };
      years.push(lastYear);
    }
    let lastMonth = lastYear.months[lastYear.months.length - 1];
    if (!lastMonth || lastMonth.monthKey !== monthKey) {
      lastMonth = { monthKey, heading: MONTH_NAMES[monthIdx], days: [] };
      lastYear.months.push(lastMonth);
    }
    lastMonth.days.push(day);
  }
  return years;
}
```

- [ ] **Step 4: Run it, verify it PASSES**

Run: `task test -- src/lib/calendar-groups.test.ts`
Expected: PASS.

- [ ] **Step 5: Render the nested hierarchy with sticky headers**

In `src/routes/calendar.tsx`:

Update the import (line 9):

```tsx
import { groupByReleaseDate, nestByYearMonth } from "@/lib/calendar-groups";
```

Replace the grouping + `hasMore` lines (35-36) with:

```tsx
  const dayGroups = groupByReleaseDate(items);
  const years = nestByYearMonth(dayGroups);
  const hasMore = dayGroups.length < loaderData.calendar.total;
```

In `loadMore`, change the offset (line 44) to use the distinct-date count:

```tsx
        offset: dayGroups.length,
```

Replace the `groups.length === 0` guard (line 55) with `dayGroups.length === 0`, and replace the `{groups.map(...)}` block (lines 61-82) with the nested render:

```tsx
          {years.map((year) => (
            <section key={year.year} className="mt-8">
              <h2 className="sticky top-0 z-20 bg-background py-1 text-xl font-bold">
                {year.year}
              </h2>
              {year.months.map((month) => (
                <div key={month.monthKey} className="mt-4">
                  <h3 className="sticky top-8 z-10 bg-background py-1 text-sm font-semibold text-muted-foreground">
                    {month.heading}
                  </h3>
                  {month.days.map((group) => (
                    <section key={group.dateKey} className="mt-4">
                      <h4 className="text-sm font-medium text-muted-foreground">
                        <time dateTime={group.dateKey}>{group.heading}</time>
                      </h4>
                      <div className="mt-2 space-y-3 border-l-2 border-border pl-3">
                        {group.buckets.map((bucket) => (
                          <div key={bucket.bucket}>
                            <h5 className="mb-1 text-xs font-medium text-muted-foreground">
                              {bucket.label}
                            </h5>
                            <div>
                              {bucket.films.map((f) => (
                                <CalendarFilmRow item={f} key={f.film_slug} />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ))}
            </section>
          ))}
```

- [ ] **Step 6: Add route-level assertions (keep existing cases)**

Open `src/routes/calendar.test.tsx`. Keep every existing test. Add a case that asserts the year and month headings render for a multi-month payload — model the MSW/loader setup on the existing tests in that file (reuse their `getCalendar` mock / `renderRoute` helper). The assertion core:

```tsx
    expect(await screen.findByRole("heading", { name: "2026" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "June" })).toBeInTheDocument();
```

- [ ] **Step 7: Full FE gate**

Run: `task test`, `task lint`, `task typecheck`, `task format`. All green. Manually confirm the existing calendar route tests still pass (date headings are now `<h4>` — update any role/level assertions in the existing cases if they pin heading level).

---

## Self-Review

**Spec coverage:**
- NEU-413 (full crew, dept-priority order, separate Director/Screenplay/Writer/Story billing, crew block) → Tasks 1 + 3. ✓
- NEU-411 (imdb/tmdb links in header, IMDb hidden when null) → Tasks 2 + 4. ✓
- NEU-412 (collapsed plot block) → Task 5. ✓
- NEU-410 (year→month→day, sticky headers, pagination unchanged) → Task 6. ✓
- Page order Plot → Cast → Crew → Companies → Tasks 5 (Plot after ReleaseDates) + 3 (Crew after Cast). ✓

**Type consistency:** `CrewMemberOut {name, job, department}` (BE Task 1) ↔ `CrewMember {name, job, department}` (FE Task 3). `crew` replaces `directors` in both DTO and FE type. `tmdb_id: int` / `imdb_id: str|None` (BE Task 2) ↔ `tmdb_id: number` / `imdb_id: string|null` (FE Task 4). `nestByYearMonth` consumes `CalendarDateGroup` (existing) and is consumed by the route. ✓

**Open deviation flagged for the user:** dropped `profile_path` + `credit_order` from `CrewMemberOut` (unused by FE); kept `department`.
