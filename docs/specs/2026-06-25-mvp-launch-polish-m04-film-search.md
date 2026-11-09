# M4 — Film search — Milestone Design

- **Date:** 2026-06-25
- **Status:** Approved (ready for per-ticket implementation plans)
- **Product:** **BackLotter** — public SSR tracker of per-film update logs (backlotter.com).
- **Components:** `upcoming-movies-backend` (NEU-400) + `upcoming-movies-frontend` (NEU-401).
- **Project / milestone:** *Movies: MVP Launch Polish* · milestone **M4 — Film search**.
- **Story & tickets:** Story **NEU-388** "Find a film by title".
  - **NEU-400** `[backend]` — new public `GET /films/search?q=` returning publicly-visible films
    matching `title` + `original_title` (case-insensitive), offset/limit envelope consistent with
    `/films`.
  - **NEU-401** `[frontend]` — search box wired into the global header (NEU-398), querying
    `GET /films/search?q=`, showing results that each link to `/film/{slug}`; debounced, accessible,
    SSR-safe, graceful no-results. **Blocked by NEU-400 and NEU-398.**
- **Builds on (shipped / in-flight):**
  - **NEU-309** — public film API: `get_film_index` (`GET /films`), `FilmIndexResponse`/`FilmIndexItem`,
    the `release_date desc nulls-last` ordering, the ≥1-summarized-event visibility rule.
  - **NEU-306 / NEU-310 / NEU-312** — React Router framework-mode SSR on Cloudflare Workers; the
    `loader → meta → component → ErrorBoundary` route template; `cloudflareContext` (Worker env →
    loaders); the base-URL-injected public fetcher pattern (`getFilm`, `getFeedGrouped`).
  - **M3 / NEU-398** — the auth-aware `GlobalHeader`, the single `NAV_ITEMS` config with the **inert
    `Search` nav entry** (`{ label: "Search", href: "/search", enabled: false }`), and the documented
    **header insertion slot** for the search affordance. M3 explicitly defers "the Search page and the
    header search box/input" to **M4**, and notes M4 "flips `Search` to `enabled` + mounts the box."
  - **M3 / NEU-399** — the `getFilms` fetcher + `FilmIndexItem`/`FilmIndexResponse` FE types, plus
    `FilmPosterCard` and the `PAGE_SIZE`/poster-grid conventions, all reusable by the results page.
- **Refs:** [2026-06-25-mvp-launch-polish-m03-navigation-site-structure.md](2026-06-25-mvp-launch-polish-m03-navigation-site-structure.md)
  (the header, the nav config, the search seam, the public SSR/provider-free invariants);
  [2026-06-22-neu-309-public-film-api-design.md](2026-06-22-neu-309-public-film-api-design.md)
  (the index endpoint this mirrors); [2026-06-23-neu-312-ssr-feed-landing-design.md](2026-06-23-neu-312-ssr-feed-landing-design.md)
  (the public SSR pattern + provider-free body).

---

## 1. Purpose & scope

Let a visitor find a tracked film by typing its title. Today there is no way to jump to a film by
name — only the home feed (`/`), the `/browse` index, and a `/film/{slug}` you already know. M4 adds
a single, title-based search path:

1. **A public `GET /films/search?q=` endpoint** (NEU-400) that returns publicly-visible films whose
   `title` or `original_title` matches the query (case-insensitive), using the **same visibility rule
   and offset/limit envelope as `GET /films`** so results are guaranteed openable at `/film/{slug}`
   and the FE can reuse the index types verbatim.
2. **A search affordance in the global header** (NEU-401): a search box mounted into the M3 header's
   reserved slot, plus a `/search` SSR results route. Typing shows a debounced live dropdown of top
   matches (each a link to `/film/{slug}`); submitting (or no-JS) lands on `/search?q=` rendered
   server-side. Accessible, SSR-safe, graceful on no-results and on error.

**In scope:** the `/films/search` service query + route + DTO reuse + tests (backend); the
`getFilmSearch` fetcher, the `/search` SSR route, the header search-box island + dropdown, the nav
flag flip, and tests (frontend).

**Explicitly out of scope (this milestone) — see §5:** **alternate-title** matching (a later
milestone's ticket — M4 only designs the query so adding it is a localized OR); any **fuzzy /
trigram / full-text** search engine (keep it simple ILIKE-style); relevance ranking, search
analytics, recent-searches, or a person/event search. No change to `GET /films` itself.

---

## 2. Architecture & approach

### 2.1 Backend — `GET /films/search?q=` (NEU-400)

The search query is a **clone of `get_film_index`'s visibility filter** with one added predicate (the
title match) and the same ordering and envelope. Grounding in the real code
(`src/upmovies/public/service.py`):

```python
# today, inside get_film_index:
has_summary = (
    select(Event.id)
    .join(EventSummary, EventSummary.event_id == Event.id)
    .where(Event.film_id == Film.id, _visible_events())   # _visible_events() = event_type NOT IN ('other',)
    .exists()
)
# visibility = Film.slug.is_not(None) AND has_summary
# order      = nulls_last(Film.release_date.desc()), Film.id.asc()
# envelope   = FilmIndexResponse(items, total, limit, offset)
```

**Refactor (small, enabling).** Extract the visibility predicate so both endpoints share one source
of truth — drift between "what's searchable" and "what's listed" would be a real bug:

```python
def _publicly_visible_film():
    """The clauses that gate a Film onto the public surface: it has a slug and ≥1 visible,
    summarized event. Shared by get_film_index and get_film_search so the two never diverge."""
    has_summary = (
        select(Event.id)
        .join(EventSummary, EventSummary.event_id == Event.id)
        .where(Event.film_id == Film.id, _visible_events())
        .exists()
    )
    return Film.slug.is_not(None), has_summary
```

`get_film_index` is rewritten to spread `*_publicly_visible_film()` into its `count` and `select`
`.where(...)` (no behavior change — its tests in `tests/integration/routers/test_public_films.py`
stay green). The item-building loop (slug/title/release_year/poster_path + `derive_arc_stage` via
`_event_types_by_film`) is likewise factored into a `_film_index_items(session, films)` helper so the
search endpoint produces byte-identical item shapes.

**The match predicate + the alt-title seam.** Define the title match as one helper returning a single
boolean clause, so the future alt-title ticket adds exactly one OR term in one place:

```python
def _title_match(q: str):
    """Case-insensitive substring match on the film's own title fields. Returns ONE boolean clause;
    the alt-title milestone extends this by OR-ing in an alt-title EXISTS subquery here — no caller
    changes. LIKE wildcards in user input are escaped so they match literally."""
    pattern = f"%{_escape_like(q)}%"
    return or_(
        Film.title.ilike(pattern, escape="\\"),
        Film.original_title.ilike(pattern, escape="\\"),   # nullable → NULL fails the predicate, fine
    )
    # FUTURE (different milestone): or_(..., <alt-title EXISTS on a film_alt_title table>)
```

- **Case-insensitivity:** Postgres `ILIKE` (via SQLAlchemy `Column.ilike(...)`). No `func.lower`
  needed.
- **Prefix vs substring:** use **substring** (`%q%`) — the most forgiving for a "find by title" box
  (matches "odyssey" inside "The Odyssey"). Implementer may switch to prefix (`q%`) if desired; the
  pattern is the only line to change. Either way the matching lives behind `_title_match`.
- **LIKE-wildcard safety:** `_escape_like(q)` escapes `%`, `_`, and `\` so a user typing `%` searches
  for a literal percent, not "match anything". A tiny pure helper (`str.replace` chain), unit-tested.
- **`original_title` is nullable** — `NULL ILIKE …` is `NULL` (not matched), which is the desired
  behavior; no `coalesce` needed.

**The search service** mirrors `get_film_index` exactly, adding `_title_match(q)`:

```python
async def get_film_search(
    session: AsyncSession, *, q: str, limit: int, offset: int
) -> FilmIndexResponse:
    term = q.strip()
    if len(term) < MIN_QUERY_LEN:                         # blank / too-short → empty envelope (200)
        return FilmIndexResponse(items=[], total=0, limit=limit, offset=offset)
    visible = _publicly_visible_film()
    where = (*visible, _title_match(term))
    total = await session.scalar(select(func.count()).select_from(Film).where(*where))
    films = (
        await session.execute(
            select(Film).where(*where)
            .order_by(nulls_last(Film.release_date.desc()), Film.id.asc())
            .limit(limit).offset(offset)
        )
    ).scalars().all()
    items = await _film_index_items(session, films)
    return FilmIndexResponse(items=items, total=total or 0, limit=limit, offset=offset)
```

**Ordering.** Reuse the index order (`release_date desc nulls-last, id asc`) for parity and
determinism. Relevance ranking (exact/prefix first) is a deliberate non-goal for M4 (§5) — for a
small catalog, newest-first is predictable and good enough.

**Response DTO — reuse `FilmIndexResponse` / `FilmIndexItem`.** The shape a result needs (slug,
title, release_year, poster_path, arc_stage) is exactly the index item, so **no new DTO**. Reuse buys
FE reuse for free: the `/search` results page renders the same `FilmPosterCard` and the FE reuses its
existing `FilmIndexItem`/`FilmIndexResponse` types and the `getFilms`-style fetcher shape. (`arc_stage`
is computed the same way; the dropdown simply ignores it.)

**Route (`src/upmovies/routers/public.py`).** Register **above** `GET /films/{slug}` so the literal
`search` segment can never be captured as a slug:

```python
@router.get("/films/search", response_model=FilmIndexResponse)
async def search_films(
    q: str = Query(..., max_length=200),
    limit: int = Query(default=20, ge=1, le=100),       # default 20: search wants fewer than the index's 50
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> FilmIndexResponse:
    return await service.get_film_search(session, q=q, limit=limit, offset=offset)
```

- **`q` required** (`...`) with a sane `max_length`; the service trims and short-circuits blank/short
  terms to an empty envelope (graceful, no 422 for an empty box). `limit`/`offset` reuse the index's
  exact bounds (`ge=1, le=100` / `ge=0`) so the envelope is consistent with `/films`.
- **Route-order gotcha is the one real trap here**: `/films/search` must be declared before the
  existing `@router.get("/films/{slug}")`, or FastAPI matches `search` as `slug` and 404s. A test
  asserts `GET /films/search` does **not** resolve to the detail handler.

**Tests** (`tests/integration/routers/test_public_films.py`, reusing the `make_film` / `add_event`
fixtures in `tests/fixtures/public.py`):
- matches on `title` (case-insensitive) and on `original_title`; substring (mid-word) match;
- **visibility parity:** a film with no summarized event / no slug whose title matches is **excluded**
  (mirror `test_index_lists_only_films_with_a_summarized_event`);
- envelope + pagination (`total`, `limit`, `offset`, `ge/le` 422s) identical to the index tests;
- blank / whitespace / too-short `q` → empty `items`, `total 0`, HTTP 200;
- LIKE-wildcard input (`%`, `_`) is treated literally;
- `GET /films/search` resolves to the search handler, not `/films/{slug}`.
- Unit-test `_escape_like` (and the matcher if extracted as a pure predicate-builder).

### 2.2 Frontend — header search box + `/search` results page (NEU-401)

Three pieces, layered so the baseline works without JS and the live dropdown is pure enhancement.

**(a) Fetcher + types — reuse the M3 index types.** Since the backend returns `FilmIndexResponse`,
add one pure, base-URL-injected fetcher beside `getFilms`/`getFilm` (`src/api/public.ts`), reusing the
`FilmIndexResponse`/`FilmIndexItem` types M3 already added to `src/api/types.ts` (**no new types**):

```ts
// src/api/public.ts
export async function getFilmSearch(
  baseUrl: string,
  q: string,
  { limit = 20, offset = 0, signal }: { limit?: number; offset?: number; signal?: AbortSignal } = {},
): Promise<FilmIndexResponse> {
  const url = new URL("/films/search", baseUrl);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal });
  if (!res.ok) throw new Error(`GET /films/search failed: ${res.status}`);
  return (await res.json()) as FilmIndexResponse;
}
```

`baseUrl` injected per the existing pattern: the **SSR `/search` loader** passes the Worker env
(`env.API_BASE_URL`); the **client dropdown** passes the browser env (`@/env` `apiBaseUrl`). One pure
fetcher, two callers, MSW-testable. The optional `signal` lets the dropdown cancel stale requests.

**(b) The `/search` SSR results page** — the backbone + no-JS/crawler fallback + the header form's
submit target. A new route under `public-layout`, following the `feed.tsx`/`browse.tsx` template:

```
route("search", "routes/search.tsx")        // added to the public-layout block in routes.ts
```

```
GET /search?q=…&page=N
  └─ loader({ request, context })
       ├─ env = context.get(cloudflareContext).env
       ├─ q = (url.searchParams.get("q") ?? "").trim()
       ├─ page → offset/limit (reuse browse's PAGE_SIZE / clampToInt)
       └─ q === "" ? { q: "", results: null }                       // landing prompt, no fetch
                   : { q, results: await getFilmSearch(env.API_BASE_URL, q, { limit, offset }) }
  meta()  → buildMeta({ title: q ? `Search: “${q}”` : "Search", … }) + { name:"robots", content:"noindex" }
  default SearchPage
       ├─ q === ""                    → "Type a film title to search."   (200)
       ├─ results.total === 0         → "No films match “{q}”."          (200, graceful)
       └─ poster grid of FilmPosterCard (reuse M3) + optional pagination
  ErrorBoundary  → neutral "couldn’t search" + link home   (getFilmSearch throw → here)
```

- **`noindex`** on the results page (append `{ name: "robots", content: "noindex" }` to the
  `buildMeta` array, exactly as `film.tsx` does for not-found) — query-string result pages are thin
  and infinite; do **not** add `/search` to the sitemap.
- Reuses `FilmPosterCard`, the empty-state idiom, and the `PAGE_SIZE`/clamp helpers from M3/NEU-399 —
  the results body is essentially Browse with a `q` and a results-scoped empty message.

**(c) The header search box** — a client island mounted into the M3 `GlobalHeader` slot.

- **SSR-safe baseline = a real form.** The header renders a `role="search"` landmark wrapping
  `<form action="/search" method="get">` with a labeled `name="q"` input and a submit control. This is
  **server-rendered and works with zero JS**: submitting navigates to `/search?q=…`. No client state,
  no hydration mismatch — the server HTML and first client paint are identical.
- **Progressive-enhancement dropdown (the island).** After hydration, the input gains a **debounced
  live combobox**: as the user types, a debounced `getFilmSearch(env.apiBaseUrl, q, { limit: 8, signal })`
  populates a dropdown listing top matches, each an `<a>/Link to={\`/film/${item.slug}\`}` (poster
  thumb + title + year), plus a **"See all results for '{q}'"** row linking to `/search?q=…`. The
  dropdown is rendered **only client-side** (gated on a mounted flag / the input being focused), so
  SSR emits just the form — preserving the M3 provider-free public-body invariant and avoiding any
  mismatch.
- **State management.** Keep the island provider-light: a small `useDebouncedSearch(q)` hook —
  `useState` for `q`/results/status + `useEffect` with a `setTimeout` debounce and an `AbortController`
  that aborts the previous request on each keystroke. No TanStack Query needed (the public body stays
  provider-free; the dropdown is ephemeral, not cached server-state). *Optional upgrade:* if request
  de-dupe/caching is wanted later, the island can mount a scoped `QueryClientProvider` mirroring M3's
  `HeaderAccount` — deferred, not needed for M4.
- **Where it mounts.** Into the **documented header insertion slot** M3 left for it, and the M3
  `NAV_ITEMS` `Search` entry flips `enabled: false → true` (its `href: "/search"` now resolves). The
  box sits within/next to `PrimaryNav` per the M3 header layout; on narrow viewports it can collapse
  to the nav's Search link (the form is the canonical affordance; the inline box is the enhancement).

**UX states (dropdown):** below min length (e.g. `< 2` chars) or empty → closed, no fetch; loading →
keep prior results / subtle pending; results → listbox + "See all"; **no-results → "No films match
'{q}'"** (`aria-live` announced); **fetch error → quietly close the dropdown** (the form still submits
to `/search`, where the ErrorBoundary handles hard failures) — a transient search blip must never
break the header.

**Accessibility:** `role="search"` landmark; an associated `<label>` (visually-hidden) or `aria-label`
on the input; the dropdown as a WAI-ARIA **combobox** (`role="combobox"`, `aria-expanded`,
`aria-controls`, `aria-activedescendant`) over a `role="listbox"` of `role="option"` rows; full
keyboard support (Down/Up to move, Enter to open the active film, Escape to dismiss and return focus);
result count / "no results" surfaced via `aria-live="polite"`. The no-JS form is inherently
keyboard/SR-accessible.

**Files:**

| File | Action | Responsibility |
|---|---|---|
| `src/api/public.ts` | modify | Add `getFilmSearch(baseUrl, q, { limit?, offset?, signal? })`. |
| `src/api/types.ts` | (none) | Reuse M3's `FilmIndexItem`/`FilmIndexResponse`. |
| `src/routes.ts` | modify | Add `route("search", "routes/search.tsx")` in the `public-layout` block. |
| `src/routes/search.tsx` | create | `loader` (q/page → `getFilmSearch`), `meta` (+`noindex`), `SearchPage`, `ErrorBoundary`. |
| `src/components/layout/nav-items.ts` | modify | Flip the `Search` entry to `enabled: true`. |
| `src/components/layout/GlobalHeader.tsx` | modify | Mount `<SearchBox/>` in the reserved slot. |
| `src/components/search/SearchBox.tsx` | create | The `role="search"` form + the post-hydration combobox dropdown island. |
| `src/components/search/useDebouncedSearch.ts` | create | Debounce + `AbortController` hook driving the dropdown. |
| `src/components/search/SearchResultItem.tsx` | create (opt.) | One dropdown row: poster thumb + title + year, links to `/film/{slug}`. |

---

## 3. Cross-cutting decisions

| Decision | Rationale |
|---|---|
| **Visibility parity with `/films`** — search reuses the *exact* `_publicly_visible_film()` predicate (slug not null + ≥1 visible summarized event), extracted and shared. | A result you can't open at `/film/{slug}` would be a dead end; sharing one predicate guarantees the search surface ⊆ the listable surface and prevents drift. |
| **Reuse `FilmIndexResponse`/`FilmIndexItem`** for the response (no new DTO). | The result shape is identical to the index; reuse gives the FE the existing types, `FilmPosterCard`, and a `getFilms`-shaped fetcher for free. |
| **Offset/limit envelope identical to `/films`** (`ge=1,le=100` / `ge=0`; `{items,total,limit,offset}`). Search defaults `limit=20`. | Consistency across public list endpoints; the FE pages search results the same way as Browse. |
| **Matching isolated in one `_title_match(q)` helper returning a single clause; alt-titles = one added OR term there.** | The next milestone's alt-title work is a localized change with zero caller churn — the explicit seam the ticket asks for. |
| **Plain ILIKE substring, case-insensitive, wildcards escaped** — no trigram/full-text/fuzzy. | "Keep it simple ILIKE-style"; the catalog is small; full-text is a later, separate decision (§5). |
| **`/films/search` declared before `/films/{slug}`.** | Otherwise `search` is captured as a slug — the one concrete footgun. Covered by a test. |
| **SSR-safe by layering:** server renders a real `role="search"` GET form → `/search`; the live dropdown is a post-hydration client island. | No-JS and crawlers get a working search; the public page body stays provider-free (NEU-312); no hydration mismatch (server emits only the form). |
| **`/search` is `noindex` and not in the sitemap.** | Query-string result pages are thin/infinite; matches the `noindex` idiom already used for not-found in `film.tsx`. |
| **Debounce + AbortController, min query length, blank short-circuit (both ends).** | Avoids a request per keystroke and races; the server also returns an empty envelope for blank/short `q`, so a stray empty call is cheap and harmless. |

### Dependencies & sequencing

- **NEU-400 blocks NEU-401** (the FE needs the live endpoint). The FE can be developed against an
  MSW mock of `GET /films/search` in parallel, but ships after the backend.
- **NEU-398 blocks NEU-401** — the search box mounts into the M3 header's reserved slot and flips the
  M3 `Search` nav entry. If M3 isn't merged, NEU-401 has nowhere to mount. The `/search` *route*
  itself only depends on the public-layout/loader pattern (already shipped), so the results page can
  exist before the header box; the **header mount** is the piece gated on M3.

---

## 4. Milestone acceptance

**NEU-400 — `GET /films/search?q=` (backend)**
- New public `GET /films/search?q=` returns publicly-visible films (slug not null + ≥1 visible
  summarized event — the **same** rule as `GET /films`, via a shared predicate) whose `title` **or**
  `original_title` matches `q` **case-insensitively** (substring).
- Response is `FilmIndexResponse` with the **same `{items,total,limit,offset}` envelope and `ge/le`
  bounds** as `/films`; ordered `release_date desc` (nulls last), then `id`.
- Blank/whitespace/too-short `q` → empty `items`, `total 0`, **HTTP 200** (graceful, not 422).
- LIKE wildcards in `q` are matched literally; the alt-title extension point is a single OR in
  `_title_match` (alt-title matching itself **not** implemented here).
- Route declared before `/films/{slug}`; `get_film_index` behavior unchanged after the refactor.
- Tests cover title + original_title + substring matching, visibility parity (excluded films),
  pagination/envelope, blank/short `q`, wildcard escaping, and route ordering. `task test` /
  `task lint` / `task typecheck` green.

**NEU-401 — header search box + results (frontend)**
- A `role="search"` search box renders in the **global header** on every public page; submitting (or
  no-JS) navigates to the **`/search?q=` SSR results page**, which lists matches as a poster grid,
  each linking to `/film/{slug}`, with a graceful **no-results** state and an empty/landing state.
- With JS, the input shows a **debounced** (min-length-gated, AbortController-cancelled) live dropdown
  of top matches each linking to `/film/{slug}`, plus "See all results" → `/search?q=`.
- **SSR-safe:** server emits only the form (no mismatch); the dropdown is post-hydration; the public
  page body stays provider-free. **Accessible:** combobox/listbox semantics, full keyboard nav,
  labeled input, `aria-live` result announcements.
- The M3 `Search` nav entry is flipped to `enabled: true`; `getFilmSearch` reuses the M3
  `FilmIndexResponse` types; fetch errors degrade gracefully (dropdown closes; page → ErrorBoundary).
- Tests (Vitest + RTL + MSW) cover the fetcher (q/limit/offset params; 200/throw), the `/search`
  loader + results render + film links + no-results + empty states, and the dropdown (debounce,
  result rendering, keyboard nav, no-results, error-degrades). `task test` / `task lint` (zero
  warnings) / `task typecheck` green; touched files prettier-clean.

---

## 5. Out of scope / deferred

| Item | Where it lives |
|---|---|
| **Alternate-title matching** (matching films by AKA / localized release titles) | **A different milestone's ticket.** M4 builds the `_title_match` OR-seam so it's a localized add; it does **not** implement alt-title storage or matching. |
| **Fuzzy / typo-tolerant / trigram / Postgres full-text search; relevance ranking** | Not M4 — "keep it simple ILIKE-style". A future search-quality effort if/when the catalog grows. M4 orders by `release_date` like the index. |
| **Searching people, events, summaries, or free text** | Out of scope — title (+ later alt-title) only. |
| **Search analytics, recent/suggested searches, trending, query logging** | Not in MVP launch polish. |
| **Indexing `/search` / adding it to the sitemap** | Intentionally `noindex`, no sitemap entry (thin query pages). |
| **Mobile search overlay / rich combobox polish** | The form + basic accessible dropdown ship; richer interactions can follow — not a milestone gate. |
| **Caching the dropdown via TanStack Query** | The island uses a debounced fetch; a scoped QueryClient is an optional later upgrade, not required. |

---

## 6. Risks / notes

- **Route ordering is the one real trap.** `/films/search` MUST precede `/films/{slug}` in
  `routers/public.py`, or `search` is captured as a slug → 404. Pinned by a test.
- **Refactor blast radius.** Extracting `_publicly_visible_film()` / `_film_index_items()` touches
  `get_film_index`; the existing `test_public_films.py` index tests are the regression net — keep them
  green to prove no behavior change.
- **Hydration determinism.** The header renders only the static `role="search"` form on the server;
  the dropdown must be gated to client-only (mounted/focused) so SSR and first paint match (per the
  M3 provider-free invariant). No `Date.now()`/locale output in the server-rendered form.
- **workerd ≠ Node.** Both the `/search` loader and `getFilmSearch` use only web `fetch`/`URL`/
  `AbortSignal`; MSW covers tests; dev fetches hit `https://api.upmovies.localhost` (self-signed) from
  workerd — same caveat as the existing feed/film loaders.
- **Request hygiene.** Debounce (~250–300 ms) + min length (≥2) + AbortController to avoid a request
  per keystroke and stale-response races; the server's blank/short short-circuit makes any stray empty
  call cheap.
- **Graceful failure.** A failing live-search must never break the header — the dropdown closes
  quietly and the canonical form still works; only the SSR `/search` page surfaces a hard error via
  its ErrorBoundary.

## Sources

- Backend index this mirrors — `src/upmovies/public/service.py` (`get_film_index`, `_visible_events`,
  `has_summary` EXISTS, `nulls_last(release_date.desc())` order), `src/upmovies/public/dto.py`
  (`FilmIndexResponse`/`FilmIndexItem`), `src/upmovies/routers/public.py` (`/films` route + `Query`
  bounds), `src/upmovies/catalog/models.py` (`Film.title`, nullable `Film.original_title`, `slug`).
- Backend test harness — `tests/integration/routers/test_public_films.py`,
  `tests/fixtures/public.py` (`make_film` / `add_event`).
- FE public SSR pattern — `src/routes/feed.tsx`, `src/routes/film.tsx` (loader → meta → component →
  ErrorBoundary; `noindex` idiom), `src/routes.ts`, `src/api/public.ts` (base-URL-injected fetchers),
  `src/routes/spa-layout.tsx` (scoped-provider island precedent).
- Milestone predecessor — [2026-06-25-mvp-launch-polish-m03-navigation-site-structure.md](2026-06-25-mvp-launch-polish-m03-navigation-site-structure.md)
  (the header, `NAV_ITEMS` Search seat, the reserved search slot, `getFilms`/`FilmPosterCard`/
  `FilmIndexResponse` FE types, provider-free invariants).
- React Router framework mode — route modules, nested layouts, `NavLink`/form navigation —
  https://reactrouter.com/start/framework/routing
