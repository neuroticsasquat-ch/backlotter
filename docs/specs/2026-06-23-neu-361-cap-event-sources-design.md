# NEU-361 — Cap per-event source citations at 3

- **Ticket:** [NEU-361](https://linear.app/neuroticsasquatch/issue/NEU-361/cap-per-event-source-citations-at-3-4) `[backend]`
- **Project / milestone:** Movies: Content Quality / MVP Quality Bar
- **Blocked by:** [NEU-360](https://linear.app/neuroticsasquatch/issue/NEU-360/backend-resolve-google-news-source-urls-to-actual-outlets) — capping before real outlet names are resolved would just show three identical `"Google News: per-film"` labels, and dedupe-by-outlet is impossible without resolved names. NEU-360 must be merged before this ships.
- **Branch:** `tom/neu-361-cap-per-event-source-citations-at-34`
- **Shape:** single backend PR. **No DTO change, no migration, no frontend change.**

## Problem

An event can be backed by 15–20+ stories. Every story becomes a `SourceOut` citation, so the public feed and the film timeline render long, noisy citation lists. Once NEU-360 resolves Google News stories to their real publisher (`Story.outlet`), most of those citations collapse to a handful of actual outlets — but nothing trims the list, and nothing dedupes it, so an event can still show four `"Deadline"` rows.

## Goal

Show at most **3** source citations per event, each a **distinct outlet**, choosing the **most recent** story per outlet. Apply this once, in the backend, where the sources list is assembled (`public/service.py`), so the feed and the film timeline share one capped, deduped list rather than each re-implementing it on the frontend.

## Key decisions (settled in brainstorming)

1. **Cap = 3** (`SOURCE_CAP = 3`, a module constant). Three distinct outlets is already strong corroboration and keeps the citation list tight. A plain constant — not a `config.py` env field — because this is display polish, not an operational knob (YAGNI; trivially promotable later).
2. **Selection = most-recent distinct outlets, newest-first.** Sort stories newest-first, keep the most-recent story per outlet, take the top 3. Deterministic and zero-maintenance. Outlet-authority ranking was rejected: it needs a subjective, hand-maintained rank table over free-text RSS outlet strings.
   - **Side effect:** within an event, sources flip from today's oldest-first ordering to **newest-first**. Accepted — the latest corroboration leads.
3. **Overflow dropped silently.** No `+N more` indicator. That would need a count field on the `EventOut`/`FeedItem` DTO plus frontend rendering — a cross-stack change beyond this backend-only ticket. Leanest path; matches MVP scope.
4. **Cap layer = backend**, in `public/service.py`, exactly as the ticket prefers. Applied in Python on the already-loaded story rows (not a per-event SQL `LIMIT`).
5. **Dedupe key = light-normalized, display verbatim.** The dedupe key is `casefold + collapse-whitespace + strip a leading "the "`; the **displayed** label stays the verbatim `outlet_label` of the kept story. This catches the common real collisions — case variants, a `"The "` prefix, and trade-feed-vs-Google name drift (`"The Hollywood Reporter"` vs `"Hollywood Reporter"`) — with no mapping table. NEU-360 explicitly punted "outlet normalization" to this ticket; this is the cheap 90% of it. Full alias-mapping (`"THR" → "The Hollywood Reporter"`, `"Variety.com" → "Variety"`) is out of scope.

## Design

### New pure module — `src/upmovies/public/sources.py`

Following the project's "split pure from DB-aware" pattern (`public/arc.py`, `catalog/slug.py`), the display + selection logic lives in a pure, DB-free, independently unit-testable module. `outlet_label` (added to `service.py` by NEU-360) **moves here** so the label rule and the cap rule live together; `service.py` re-imports it.

```python
from upmovies.news.models import Story

SOURCE_CAP = 3


def outlet_label(story: Story) -> str:
    """Display label for a source: the resolved publisher when present (Google News
    rows), otherwise the stored `source` (trade feeds, or unresolved rows)."""
    return story.outlet or story.source


def _dedupe_key(label: str) -> str:
    """Normalized key for distinct-outlet dedupe. Display still uses the verbatim
    label; this only decides which citations count as the same outlet."""
    norm = " ".join(label.casefold().split())  # casefold + collapse internal whitespace
    if norm.startswith("the "):
        norm = norm[4:]
    return norm


def cap_sources(stories: list[Story], cap: int = SOURCE_CAP) -> list[Story]:
    """Most-recent distinct outlets, newest-first, capped to `cap`.

    Order-independent of the input: sorts internally (newest published_at first,
    NULL published_at last, story id as a stable tiebreak), keeps the first story
    seen per normalized outlet (= the most recent), and returns at most `cap`.
    """
    ordered = sorted(
        stories,
        key=lambda s: (
            s.published_at is None,  # non-NULL first
            -(s.published_at.timestamp()) if s.published_at else 0.0,  # newest first
            str(s.id),  # stable tiebreak
        ),
    )
    seen: set[str] = set()
    result: list[Story] = []
    for story in ordered:
        key = _dedupe_key(outlet_label(story))
        if key in seen:
            continue
        seen.add(key)
        result.append(story)
        if len(result) >= cap:
            break
    return result
```

Notes:
- `cap_sources` **sorts internally** and does not trust the DB's incoming `published_at ASC` order, making it a deterministic pure function safe to test in isolation.
- `.timestamp()` is used rather than comparing `datetime` objects directly: it yields a float per row, sidesteps any naive-vs-aware `datetime` comparison `TypeError`, and exactness of the tz interpretation is irrelevant to dedupe determinism.
- A NULL `outlet` falls back to `source` inside `outlet_label`, so trade-feed stories and unresolved Google rows still dedupe sensibly.

### Wiring — `src/upmovies/public/service.py`

`service.py` drops its local `outlet_label` definition and imports `cap_sources` (and `outlet_label`) from `public.sources`. Both source-assembly sites change identically — the film-detail timeline (`get_film_detail`) and the feed (`get_feed`):

```python
sources=[
    SourceOut(
        url=story.url,
        source=outlet_label(story),
        title=story.title,
        published_at=story.published_at,
    )
    for story in cap_sources(sources_by_event.get(event.id, []))
]
```

The DB queries are unchanged; the only difference is the list comprehension iterates `cap_sources(...)` instead of the raw `sources_by_event.get(...)`. Loading all stories then trimming in Python is deliberate: events-per-page (`limit` ≈ 50) and stories-per-event (a few dozen) are both bounded, so a per-event SQL `LIMIT`/window function buys nothing and dedupe-by-normalized-outlet isn't expressible cleanly in SQL anyway.

## Testing (TDD, pure-first)

**`sources.py` units** (no DB):
- under-cap input → all returned, re-sorted newest-first.
- over-cap distinct outlets → trimmed to exactly 3.
- duplicate outlets → deduped, the **most-recent** story per outlet survives.
- NULL `outlet` → falls back to `source` for both the key and the display label.
- NULL `published_at` → sorts last (after all dated stories).
- `id` tiebreak → deterministic order when two stories share a `published_at`.
- normalization collisions dedupe: `"The Hollywood Reporter"` vs `"Hollywood Reporter"`, case variants, and stray whitespace map to one citation; the **verbatim** label of the kept story is preserved for display.

**`service.py` integration** (DB) — assert at **both** `get_film_detail` and `get_feed`:
- an event with > 3 stories across many outlets → at most 3 `SourceOut`, all distinct outlets, newest-first.
- an event with duplicate-outlet stories → one citation per outlet, most-recent kept.

## Acceptance criteria (ticket) → coverage

- *No event displays more than 4 source citations.* → `SOURCE_CAP = 3` enforced by `cap_sources`; asserted at both sites.
- *Sources are deduped by outlet before the cap.* → normalized-key dedupe in `cap_sources` runs before the cap.
- *The cap is applied after outlet name resolution (NEU-360).* → dedupe key derives from `outlet_label` = `story.outlet or story.source`; this ticket is blocked by NEU-360.
- *Cap layer (API vs frontend) decided and documented — backend preferred.* → backend, in `public/service.py`, via the shared pure helper.

## Out of scope

- **`+N more` overflow indicator** — silent drop (decision 3); would require a DTO field + frontend work.
- **Outlet alias-mapping** (`"THR" → "The Hollywood Reporter"`, domain-to-name) — only light normalization here (decision 5).
- **DTO / schema / migration / frontend changes** — none; `SourceOut` is unchanged and the FE already renders `source`.
- **Per-event SQL `LIMIT`** — trimming happens in Python on already-loaded rows.
