# Resolve Google News story URLs to the real publisher URL

- **Ticket:** [NEU-442](https://linear.app/neuroticsasquatch/issue/NEU-442/backend-resolve-google-news-story-urls-to-publisher-urls) `[backend]`
- **Project / milestone:** Movies: Content Quality
- **Related:** [NEU-360](https://linear.app/neuroticsasquatch/issue/NEU-360) resolved Google News *outlet names*; this resolves the *URLs* those same stories link to. NEU-360 deliberately deferred URL-redirect-following — this design picks it back up with a method NEU-360 did not consider.
- **Shape:** single backend PR (no frontend changes)

## Problem

Stories discovered via Google News RSS are stored with the Google redirect URL as `story.url` — e.g. `https://news.google.com/rss/articles/{id}` (`news/fetcher.py:102`, `url = entry.get("link")`). That URL flows straight through `public/service.py` → `SourceOut.url` → `SourceLinks.tsx:25` into the `<a href>` the user clicks.

So even though NEU-360 already resolves and displays the real **outlet name** ("Variety", "Deadline"), the link itself still points at `news.google.com`, not the publisher. The destination shown in the browser status bar, hover preview, and "copy link" is an opaque Google redirect rather than the real article URL — a credibility/trust gap on links we present as coming from named trades.

NEU-360 explicitly ruled out resolving these URLs, but only considered HTTP redirect-following: "Google encodes `news.google.com/rss/articles/…` redirects (since ~2024); `httpx` `follow_redirects` will not reliably reach the publisher." That conclusion is correct **for redirect-following**. It does not apply to the *batchexecute* decode method this design uses.

## Goal

For Google News stories that are **linked to a film and attached to a displayed event**, resolve the Google redirect URL to the real publisher URL and serve that as the source link. Resolution is best-effort: any failure degrades gracefully to the existing Google News URL, and the original URL is never overwritten.

Scoping to displayed stories is what makes this viable — the vast majority of ingested stories are rejected at linking or never cluster into a displayed event, so decoding only the displayed subset keeps the volume small enough to stay clear of Google's rate limits and to cache permanently.

## Key decisions (settled in brainstorming)

1. **Motivation = link quality / trust.** The displayed outlet name is already correct (NEU-360); this fixes where the link actually points.
2. **Decode at synthesis time.** Resolution runs as a stage in the synthesize pipeline (`synthesize/pipeline.py`), bounded to events that pass through synthesis. Off the user request path; same cadence as summarization.
3. **Leave existing displayed events as-is.** Only events synthesized *after* this ships become eligible. Pre-existing rows keep their Google News URLs and fall back gracefully. No backfill.
4. **Capped retry on failure.** A transient failure (429, timeout) retries on subsequent pipeline runs up to `MAX_ATTEMPTS = 3`, then gives up permanently.
5. **Vendor a small internal decoder**, not a third-party library. ~50–80 lines in `news/resolve.py` over the existing `httpx` dep; respx-testable; no new fragile dependency.
6. **No visible frontend change.** The swap happens at the API boundary (`SourceOut.url = story.resolved_url or story.url`). `SourceLinks.tsx` is untouched.
7. **Decode method = batchexecute, not redirect-following.** Confirmed still working through 2025; supersedes NEU-360's `follow_redirects` dead end.

## Design

### Data model — `news/models.py`

Three new columns on `news.story`. The original `url` is never modified.

| Column | Type | Default | Meaning |
|---|---|---|---|
| `resolved_url` | `str \| None` | `NULL` | Decoded publisher URL. `NULL` ⇒ API falls back to `url`. |
| `resolve_state` | `str` | `'none'` | State machine (below). |
| `resolve_attempts` | `int` | `0` | Decode attempts so far; flips `'pending'` → `'failed'` at `MAX_ATTEMPTS`. |

`resolve_state` values:

- **`'none'`** — not eligible. All pre-existing rows, all non–Google-News rows, and any story never attached to a displayed event. This is the boundary that delivers "leave existing as-is": old rows stay `'none'` and are never swept up.
- **`'pending'`** — eligible, not yet resolved, attempts remaining.
- **`'resolved'`** — `resolved_url` populated; terminal, never re-attempted.
- **`'failed'`** — hit the attempts cap without success; terminal, falls back to the Google URL forever.

The enum is stored explicitly (rather than inferred from `resolved_url`/`resolve_attempts`) so the eligibility boundary is queryable and terminal-failed is cleanly distinct from still-retrying.

### Decoder — new module `news/resolve.py`

```python
async def resolve_google_news_url(client: httpx.AsyncClient, url: str) -> str | None:
    """Resolve a news.google.com/.../articles/... URL to the real publisher URL.
    Returns None on any failure (not a Google News URL, network error, 429,
    scheme change, unparseable response). Never raises."""
```

Steps (the batchexecute method):

1. Confirm the URL is `news.google.com/.../articles/{id}`; if not, return `None` (trade-feed URLs are safe no-ops).
2. Extract the base64 article ID from the path.
3. `GET` the Google News article page; scrape the `data-n-a-sg` (signature) and `data-n-a-ts` (timestamp) attributes.
4. `POST` them to `https://news.google.com/_/DotsSplashUi/data/batchexecute`.
5. Parse the nested JSON response for the publisher URL; return it, or `None` if anything is missing.

Properties:

- **Pure function over an injected `httpx.AsyncClient`** — no global state, no DB. Unit-testable with respx against recorded fixtures.
- **Total** — every failure path returns `None`. The caller decides what `None` means.
- Owns nothing about retry / eligibility / state — that is the pipeline's job.

> **Implementation risk — front-loaded spike.** The batchexecute wire protocol is undocumented and Google changes it periodically. The **first implementation task is a throwaway spike** that hits live Google with a current URL to confirm the exact request/response shape before building the module and its fixtures. If the method is broken at implementation time, that is a cheap early exit rather than a half-built feature.

### Pipeline integration — `synthesize/pipeline.py`

A new resolution stage runs each `run_synthesize_ingest` invocation, after summarization, reusing the same `session_factory`. Fully decoupled: if it throws, committed summaries are unaffected.

**(a) Mark eligibility — at synthesis time.** As `_select_pending` processes an event (new or refreshed), each of its stories whose `url` is a Google News URL and whose `resolve_state = 'none'` flips to `'pending'`. This is the only on-ramp from `'none'`, so only events synthesized after this ships become eligible; old events and trade-feed stories stay `'none'`.

**(b) Resolve — dedicated sub-stage.** Independently of summary selection, select stories with `resolve_state = 'pending'` across the whole table (not just this run's events — this is what lets a transient failure retry on a later run). For each, in order:

- Call `resolve_google_news_url`; increment `resolve_attempts`.
- Success → set `resolved_url`, `resolve_state = 'resolved'`.
- `None` → if `resolve_attempts >= 3`, set `resolve_state = 'failed'`; else leave `'pending'`.
- Commit per story (matches the pipeline's "one failure never rolls back others" convention).

**Throttling / rate-limit safety:**

- Sequential, no concurrency, with a small politeness delay between requests (scraping calls to Google, not our own API).
- A **per-run cap** (`RESOLVE_PER_RUN = 50`) so one run can't hammer Google; the remainder stay `'pending'` and drain over subsequent runs. `log` a message when the cap truncates (no silent caps).
- A 429 returns `None` → counts as a failed attempt; backs off naturally via the cap and delay.

**Run accounting:** report resolved / failed / still-pending counts into `ingest.runs` alongside the summary counts, so resolution is observable in `/admin/runs`.

### API boundary — `public/service.py`

Where `SourceOut` is constructed, set `url = story.resolved_url or story.url`. `SourceOut.url` keeps its meaning ("the best link for this source"); `outlet_label(story)` is untouched. `SourceLinks.tsx` reads `source.url` unchanged — **zero frontend changes**.

## Testing (TDD — failing test first)

- **`resolve.py` unit tests** (respx, recorded fixtures): happy path; non–Google-News URL → `None`; missing signature → `None`; 429 → `None`; malformed batchexecute JSON → `None`.
- **Resolution-stage tests:** eligibility marking (`'none'` → `'pending'` only for Google News stories on synthesized events; pre-existing rows untouched); success → `'resolved'` + `resolved_url`; capped retry (`'pending'` through attempt 3, then `'failed'`); per-run cap truncation logs and leaves remainder `'pending'`; decode failure does not roll back summaries.
- **Public API test:** `SourceOut.url` returns `resolved_url` when present; falls back to the Google URL when `NULL` / `'failed'`.

## Migration

Add the three columns to the `Story` model first (tests pick them up via `create_all`), then `task makemigration -- "add story url resolution columns"`, review, `task migrate`. All columns are nullable or defaulted — safe additive migration, no backfill.

## Out of scope

- No frontend changes.
- No re-resolution / backfill of existing displayed events.
- No change to the displayed outlet name (handled by NEU-360).
- No `nofollow` / `rel` changes on the link.
- No decoding at fetch/ingest time — only at synthesis, only for displayed stories.
- No third-party decoder dependency.
