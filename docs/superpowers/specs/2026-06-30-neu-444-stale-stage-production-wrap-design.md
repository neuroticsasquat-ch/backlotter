# NEU-444 — Old stories classified as new: gate stale `production_wrap` events

- **Ticket:** [NEU-444](https://linear.app/neuroticsasquatch/issue/NEU-444/bug-old-stories-getting-classified-by-ingestor-as-new) `[backend]` (Bug)
- **Project / milestone:** backlotter: Maintenance
- **Related:** [NEU-367](https://linear.app/neuroticsasquatch/issue/NEU-367) introduced the stale-stage gate this design extends; [NEU-442](https://linear.app/neuroticsasquatch/issue/NEU-442) (resolve Google News URLs) is the dependency for the deferred true-date follow-up.
- **Shape:** single backend PR (no migration, no config, no DTO/public/frontend change).

## Problem (as reported)

A news story from toy-people.com dated **2025-08-21** (almost a year old) was ingested on **2026-06-30** and clustered into a brand-new **"Production wrap"** event for *Spider-Man: Brand New Day* ("Filming in Glasgow has wrapped"). Old stories are being classified by the ingestor as new.

## Root cause (established by investigation)

The bug is **not** a date-parsing failure or a NULL-date fallback. It is that **Google News RSS misreports publication dates**: the `pubDate` it serves reflects when Google *re-surfaced* an article, not when the publisher actually published it.

Evidence (localdev `news.story`): every per-film Google News story — including the toy-people outlet — has a **non-NULL** `published_at` that exactly matches Google's recent `raw.published` (e.g. `Fri, 26 Jun 2026 02:41:05 GMT`), never the article's true date. The per-film source queries Google with `{title} when:{N}d` (`news/feeds.py`); for a 2025-08-21 article to appear in a `when:Nd` feed at all, Google's own index date for it must be recent — and that recent date is exactly what `_published_at()` parses into `published_at` (`news/fetcher.py:87`).

Consequently a re-surfaced old article:

1. Passes the feed-level stale-drop (`drop_stale`, `news/fetcher.py:119` — `published_at` looks recent).
2. Passes the link-recency filter `coalesce(published_at, fetched_at) >= now - LINK_RECENCY_DAYS` (`link/pipeline.py:289`).
3. Gets `occurred_at = min(published_at …)` = the fake-recent date (`link/cluster.py:324`) → a new event that looks brand-new.

No recency-window tuning or NULL-handling fixes a source that confidently reports the wrong date.

> **Latent, separate bug (not fixed here):** when `published_at` *is* genuinely NULL, the `coalesce(published_at, fetched_at)` fallback at `link/pipeline.py:289` and `link/cluster.py:324` substitutes ingest time, which would also let a truly-undated old story through. This is real but is **not** the NEU-444 vector (these Google dates are non-NULL). Noted as a follow-up candidate, not in scope.

## Chosen approach — extend the deterministic stale-stage gate

Of the options weighed (targeted stale-stage gate / broad true-date verification / layered), the **targeted stale-stage gate** was chosen: deterministic, cheap, reuses existing machinery, zero new dependencies. The broad true-date approach (fetch each article's real publish date, building on NEU-442's Google-News URL decoder) addresses the root cause across all beats but is expensive, fragile, and timing-awkward (NEU-442 resolves at synthesis, *after* linking) — deferred to a separate follow-up.

### The change

`NEU-367` already rejects a **new** event at clustering when an early-production beat is reported for a film that has already wrapped or released:

```python
# src/upmovies/link/cluster.py (current)
_STALE_EVENT_TYPES = {"announced", "casting", "production_start"}
_WRAPPED_STATUSES  = {"Post Production", "Released"}

def is_stale_stage(event_type: str, film_status: str | None) -> bool:
    return event_type in _STALE_EVENT_TYPES and film_status in _WRAPPED_STATUSES
```

Add `production_wrap` to `_STALE_EVENT_TYPES`:

```python
_STALE_EVENT_TYPES = {"announced", "casting", "production_start", "production_wrap"}
```

Update the `is_stale_stage` docstring to include `production_wrap` in its enumeration of gated beats.

That is the entire behavioral change. The existing apply path (`link/cluster.py:314`) then rejects the new-event group with `link_status="rejected"`, `film_id=None`, `link_confidence=None`, `link_note="stale-stage:production_wrap"`, idempotently consuming its stories.

### Why it is correct

A film in `"Post Production"` has by definition already wrapped principal photography (`public/arc.py:19` maps `"Post Production" → "wrapped"`); a `"Released"` film likewise. A *new* `production_wrap` event on either is logically stale. This matches the reported case exactly: *Spider-Man: Brand New Day* is `status = "Post Production"` (release 2026-07-29), so the re-surfaced 2025-08-21 wrap story would now be rejected with `link_note="stale-stage:production_wrap"` instead of spawning an event.

The gate fires only on the **new-event** branch. Attach-to-existing (`link/cluster.py:300`) is untouched, so a re-surfaced wrap story that legitimately continues an existing wrap event still attaches normally.

### Accepted trade-off

If TMDB has already flipped a film to `"Post Production"` at the exact moment a *genuine* wrap announcement breaks, that legitimate beat is rejected too. This is acceptable and consistent with NEU-367's existing posture for `production_start`: the public film page already shows "wrapped" via the film-status arc, so only the explicit timeline beat is lost, never the wrapped state. The far more common case — old wrap stories re-surfaced with fake-recent dates — is correctly killed.

## Scope boundaries

**In scope:**

- Add `production_wrap` to `_STALE_EVENT_TYPES` in `link/cluster.py` + docstring update.
- Tests (below).

**Out of scope (deliberate, per the "targeted" decision):**

- Other beat types (`trailer`, `release_date`) are **not** gated — trailers legitimately re-drop and release dates legitimately shift on late-stage films; gating them would cause real false-rejects. Only `production_wrap` is unambiguously stale on a wrapped film.
- The underlying Google-News date-unreliability problem and the latent `coalesce` NULL-fallback bug — documented follow-up candidates (true-date verification dependent on NEU-442), not fixed here.
- No DB migration, config flag, DTO change, public-surface change, or frontend change.

## Testing (TDD — failing test first)

Mirror NEU-367's tests in `tests/integration/link/` (integration tests must be run as a directory/suite, not a single file — known pytest-asyncio quirk):

- A new `production_wrap` event proposed for a `"Post Production"` film → rejected: stories `link_status="rejected"`, `film_id` nulled, `link_note="stale-stage:production_wrap"`; no `Event` row created.
- The same for a `"Released"` film → rejected.
- A `production_wrap` event for an `"In Production"` (and a `NULL`/unknown-status) film → allowed: `Event` created normally.
- If a unit test exists for `is_stale_stage`, extend it to assert `is_stale_stage("production_wrap", "Post Production") is True` and `is_stale_stage("production_wrap", "In Production") is False`.

## Definition of done

- `production_wrap` added to the gate; docstring updated.
- New/updated tests green; `task test`, `task lint`, `task typecheck` all green.
- One backend PR on the ticket branch.
