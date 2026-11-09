# Film page + calendar polish — Design (NEU-410 / 411 / 412 / 413)

**Date:** 2026-06-27
**Cycle:** current (Neuroticsasquatch)
**Repos:** `upcoming-movies-backend` (FastAPI / SQLAlchemy), `upcoming-movies-frontend` (React / TS / Vite)

Four independent user stories from the current cycle (label `backlotter`). Two require both
backend and frontend work and are split into per-repo child tickets (1 ticket = 1 PR); two are
frontend-only and stay single.

| Story | Backend | Frontend | Split |
|---|---|---|---|
| NEU-410 Calendar year→month→day | No | Yes | No (FE-only) |
| NEU-411 IMDB/TMDB links | Yes | Yes | **Yes** (BE + FE) |
| NEU-412 Plot summary block | No | Yes | No (FE-only) |
| NEU-413 Full crew display | Yes | Yes | **Yes** (BE + FE) |

---

## NEU-413 — Full crew + restructured director/writer display *(split: BE + FE)*

Today the film-detail API returns only `cast` (capped at 12) and `directors: list[str]`
(crew where `job == "Director"`). This story exposes the **complete** crew and restructures the
top-of-page billing.

### Backend (`upcoming-movies-backend`)

- **DTO** (`src/upmovies/public/dto.py`): add
  `CrewMemberOut { name: str, job: str | None, department: str | None, profile_path: str | None, credit_order: int | None }`
  and a `crew: list[CrewMemberOut]` field on `FilmDetailResponse`.
- **Remove** the existing `directors: list[str]` field. The top-of-page Director/Writer display is
  now derived from `crew` on the frontend, giving a single source of truth.
- **Service** (`src/upmovies/public/service.py`, `get_film_detail`): add a query for all
  `FilmCredit` rows where `credit_type == "crew"`, joined to `Person`, returning name + job +
  department + profile_path + credit_order. No cap.
- **Ordering** (applied in the query / in Python): by **department priority**, then **job**
  (alphabetical), then `credit_order` (nulls last), then `name`.
  - Department priority order:
    `Directing, Writing, Production, Camera, Editing, Sound, Art, Costume & Make-Up,
    Visual Effects, Lighting, Crew`.
    Any department not in this list sorts after the known ones, alphabetically.
  - **Known caveat (accepted):** within-department job ordering is alphabetical, so e.g. Production
    renders `Co-Producer, Executive Producer, Producer` rather than Producer-first. Shipping as-is;
    a small per-job priority override can be added later if it reads poorly. Do **not** build a
    large job-priority table now.

### Frontend (`upcoming-movies-frontend`)

- **Top billing block** (`src/components/film/FilmHeader.tsx`): derive from `crew` (the
  `directors` field no longer exists). Render **separate labels**, each a label with names listed
  one per line:
  - `Director` — crew where `job == "Director"`
  - `Screenplay` — `job == "Screenplay"`
  - `Writer` — `job == "Writer"`
  - `Story` — `job == "Story"`

  Only render labels that have ≥1 person. "Screenwriting" = the set `{Screenplay, Writer, Story}`.
- **Full crew block**: new `src/components/film/FilmCrew.tsx`, wrapping `CollapsibleSection`
  (same pattern as `FilmCredits` / `ProductionCompanies`). Adjacency-group the already-ordered
  `crew` list by `job` into job-title labels with the people listed below each (mirror the
  adjacency-walk approach in `src/lib/calendar-groups.ts` — do not re-sort). Shows the complete
  crew. Director/screenwriters intentionally appear here too, in addition to the top block.
- **Types** (`src/api/types.ts`): add `CrewMember` + `crew` to `FilmDetail`; remove `directors`.

---

## NEU-411 — IMDB / TMDB links *(split: BE + FE)*

`imdb_id`, `tmdb_id`, and `homepage` are already stored on the `Film` model and captured during
ingest, but none are in the film-detail response.

### Backend
- Add `imdb_id: str | None` and `tmdb_id: int` to `FilmDetailResponse` (`public/dto.py`) and
  populate them in `get_film_detail`. (`homepage` is out of scope — ticket asks for IMDb + TMDB
  only.)

### Frontend
- Add `imdb_id` / `tmdb_id` to the `FilmDetail` type.
- Render a small icon row inside `FilmHeader`'s metadata area (near runtime / genres):
  - IMDb → `https://www.imdb.com/title/{imdb_id}/` — **hidden when `imdb_id` is null**.
  - TMDB → `https://www.themoviedb.org/movie/{tmdb_id}` — always present.
  - Links open in a new tab (`target="_blank"`, `rel="noopener noreferrer"`).

---

## NEU-412 — Plot summary block *(FE-only)*

`overview` is already served by the API and already present on the `FilmDetail` type — just never
rendered.

- New `src/components/film/FilmPlot.tsx` wrapping `CollapsibleSection`, rendering `overview`.
- Hidden when `overview` is null/empty.
- Collapsed by default, consistent with the other blocks.

---

## NEU-410 — Calendar year → month → day *(FE-only)*

The calendar API already returns a flat list ordered by `release_date`; grouping is pure
presentation. No backend change.

- Extend `src/lib/calendar-groups.ts` to nest the existing date groups under **month** and **year**
  (year → month → day → release-type bucket). Keep the adjacency-walk approach (preserve backend
  order; no re-sorting).
- Render in `src/routes/calendar.tsx` with **sticky pinned** year + month headers (header pins to
  top of viewport while its section scrolls). Day grouping and within-day release-type buckets are
  unchanged.
- **Pagination is unchanged** — still paginates by distinct release date ("View more"). Year/month
  headers are emitted whenever the value changes within the already-loaded date stream.

---

## Page layout (collapsible stack)

```
FilmHeader        (title, year, poster, director/writer block, runtime, rating, genres, IMDb/TMDB links)
ReleaseDates
▸ Plot            (NEU-412, new)
▸ Cast (12)
▸ Crew (all)      (NEU-413, new)
▸ Companies
EventTimeline
```

---

## Resulting Linear tickets

- **NEU-413** → child **BE** (crew list + ordering in API; drop `directors`) + child **FE**
  (crew block + restructured director/writer display). FE blocked-by BE.
- **NEU-411** → child **BE** (expose `imdb_id` / `tmdb_id`) + child **FE** (link icons). FE
  blocked-by BE.
- **NEU-410**, **NEU-412** → remain single FE tickets (no children).

Parents keep the `Story` label; children are assigned to the user; blocks/blocked-by relations are
wired where a real dependency exists (FE → BE within 411 and 413).

---

## Out of scope / non-goals

- No `homepage` link (411 is IMDb + TMDB only).
- No per-job priority ordering table (413 — alphabetical within department, tune later).
- No backend changes for the calendar (410) or plot (412).
- No change to the cast cap (12) or to the calendar pagination model.
