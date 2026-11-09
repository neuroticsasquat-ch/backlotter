# Per-film Targeted Google News Fetching — Spike

- **Date:** 2026-06-20
- **Status:** Spike complete — **recommendation: adopt as a hybrid** (broad queries stay; add per-film)
- **Component:** `upcoming-movies-backend` — `news` feeds pipeline (`feeds.py`, `fetcher.py`)
- **Linear:** project *Movies: Ingestion & Feeds*; spike NEU-287
- **Builds on:** [2026-06-20-feed-recency-hygiene-design.md](2026-06-20-feed-recency-hygiene-design.md) (NEU-283, shipped)

## The question

Today the Google side of the feeds pipeline is **four broad RSS queries** (`movie casting`,
`movie release date`, `movie trailer`, `movie greenlight`), each now carrying `when:Nd`
(NEU-283). Each is ~100 results, relevance-ranked — so a low-profile tracked film's news
*can never surface*. The hypothesis: replace (or augment) the broad queries with **one
targeted query per tracked film**, built from the catalog roster, to guarantee per-film
coverage.

Decision asked of this spike: **adopt / reject / hybrid**, gated on an empirical
measurement of request latency and rate-limiting (the biggest unknown).

## Method

A throttled probe reusing the **exact prod path** (httpx + feedparser, prod `User-Agent`)
inside the backend container, against the live roster (216 films in `catalog.film`):

- **Probe 1:** stratified 48-film sample (8 head, 9 short-title, 21 mid, 10 tail), quoted
  query `"<title>" when:14d`, **1.2s throttle**, early-stop on any non-200/captcha.
- **Probe 2:** quoted vs. unquoted for 5 title-variant cases.
- Total external footprint: **58 requests, all HTTP 200, zero blocks.**

## Findings

### 1. No rate-limiting at the throttled cadence — feasible on runtime

48 sequential requests at 1.2s throttle: every one HTTP 200, no captcha/429/403.
Latency **p50 0.43s / p95 0.65s / max 0.92s** (latency is dominated by the throttle, not
the request). Projected full 216-film serialized run ≈ **5.9 min** at 1.2s (≈ 4.3 min at
1 req/s) — matches the ticket's ~3–4 min estimate, comfortably inside a daily cron.

**Caveat (residual unknown):** a one-off 48-request burst is *not* proof that ~216
requests/day, sustained, is tolerated indefinitely against an undocumented endpoint with no
ToS for this use. This lowers the risk materially but does not eliminate it. Mitigation:
keep the polite throttle + identifying UA, and alarm on the first 4xx/captcha (record it as a
run failure rather than silently degrading).

### 2. The value is in the tail — exactly where broad queries fail

% of sampled films returning ≥1 entry: head 100%, mid 100%, short 78%, **tail 70%**. The
real wins are low-profile films broad relevance-ranked queries never rank high enough to
include:

- **Lilo & Stitch 2** — 56 entries, real director-announcement coverage.
- **The Truthers** — 25 entries, the Netflix trailer drop.
- **Ebenezer: A Christmas Carol** — 7 entries, the Johnny Depp casting.

None of these would surface in a 100-result broad query. The head (Spider-Man, Shrek 5,
Avengers) is already saturated by broad queries, so per-film adds little *there* — its
marginal value is concentrated in the mid/tail. This aligns directly with the product
thesis (comprehensive per-movie tracking, including films the trade firehoses ignore).

### 3. Precision is *not* solved by targeting — the linker stays mandatory

As the ticket predicted, targeting raises recall, not precision. Common-word titles return
high-volume, on-topic-*looking* noise:

| Title | What came back |
|---|---|
| `Runner` | running / track-and-field sports |
| `Jimmy` | Jimmy John's sandwiches |
| `Dragon` | *House of the Dragon* (TV) |
| `Tony` | obituaries, Tony Awards |
| `Trinidad` | a police-chief resignation |
| `Onslaught` | "The IPO Onslaught" (WSJ) |
| `Elden Ring` | the video game |
| `Digger` / `Mutiny` | a dairy plant / a soccer club |

Per-film targeting changes the *shape* of the noise (per-film false friends instead of
broad off-topic) but does not reduce it. The Stage-1 LLM linker is still required — this
spike does not change that. Distinctive short titles, by contrast, work cleanly (`Hexed`,
`Gatto`).

### 4. Quoting is a recall/precision knob, not a correctness switch

Google News quoting is **fuzzy relevance matching, not strict phrase matching**. Quoted
queries return fewer, tighter results; unquoted broadens recall at a precision cost:

| Title | quoted (entries / relevant) | unquoted (entries / relevant) |
|---|---|---|
| Avatar Aang: The Last Airbender | 12 / 11 | 61 / 54 |
| Practical Magic 2 | 20 / 6 | 57 / 6 |

TMDB's canonical title often differs from the press string (TMDB "Avatar Aang: The Last
Airbender" vs. press "Avatar: The Last Airbender"); quoting narrows recall there but does
**not** zero it out. Since precision lives downstream in the linker, lean toward the
**unquoted** query (or quoted-with-unquoted-fallback) to maximize the recall this approach
exists to buy. Validate the exact form during implementation.

### 5. Many tail films legitimately return nothing — that's correct

`Margie Claus`, `Iliya Muromets`, `Se Eu Fosse Você 3`, and the Chinese-titled entry
returned 0 entries — no recent English-language news exists. That is expected behavior
(nothing to report), not a failure mode, and costs one cheap empty request.

## Recommendation: hybrid (broad + per-film)

**Adopt per-film queries *in addition to* the four broad queries**, rather than replacing
them.

Rationale:
- Per-film buys the tail recall that is the product's differentiation (Finding 2).
- Broad queries are nearly free (4 requests) and provide head coverage, serendipitous
  discovery of films not yet in the roster, and a hedge against per-film title-string misses
  (Finding 4) — so there is no reason to drop them.
- Both paths feed the same `news.story` table (URL-deduped) and the same downstream linker,
  which already provides the precision neither query strategy can (Finding 3).

### Shape of the change

- **Query construction:** build one Google News source per roster film,
  `<title> when:{recency}d`, **unquoted** (validate quoted-fallback during build). Skip the
  ~quoted variant for now.
- **Window vs. cron coupling:** keep a comfortable window (≥ 7d; reuse `FEED_RECENCY_DAYS`=14
  rather than the ticket's hypothetical `when:2d`). A 2-day window has no buffer — one missed
  daily run = a permanent gap. URL-dedup (`ON CONFLICT DO NOTHING`) already makes overlapping
  windows free, so a wide window costs nothing.
- **Architecture:** `feed_sources()` becomes roster-aware — it needs the list of titles, so
  `news` couples to `catalog` at fetch time (today deliberately separate: fetch broad → link
  later). The fetcher iterates `(name, url)` sources unchanged, so adding ~216 sources is
  mechanically trivial; the coupling is the only real design cost. Build the per-film source
  list from a `catalog.film` query (mirror `link/roster.py`), passed into the feeds run the
  same way `recency_days` is.
- **Throttle:** ~1 req/s, prod UA, **fail the run on the first 4xx/captcha** (don't silently
  continue) so block onset is observable.

## Open risks / validate in implementation

1. **Sustained daily volume** (Finding 1 caveat) — the one unquantified risk. Ship behind a
   config flag so per-film can be disabled instantly if blocking appears; monitor run status.
2. **Noise volume** — per-film roughly doubles raw-story inflow from common-word titles. The
   recency gate + linker absorb it, but watch `news.story` growth and linker reject rate.
3. **Query form** — quoted vs. unquoted vs. `original_title` for non-English films: a quick
   A/B during build, not another spike.

## Out of scope

- Replacing the broad queries (rejected — they stay).
- Any change to the linker (NEU-287 is fetch-side only; precision is the linker's job).
- Per-source DB-backed config (`news.feed_source`) — the static + roster-built list is fine
  until source tuning is actually needed.

## Appendix — raw probe data

48-film stratified probe, quoted `when:14d`, 1.2s throttle, prod UA. All HTTP 200.

```
latency_s  p50 0.43 / p95 0.65 / max 0.92    projected 216-run ≈ 5.9 min serialized
% returning ≥1 entry   head 100%  mid 100%  short 78%  tail 70%
avg entries/film       head 89   mid 55   short 66   tail 17
tail wins   Lilo & Stitch 2 (56)  The Truthers (25)  Ebenezer (7)
noise       Runner=sports  Jimmy=sandwiches  Dragon=HotD  Tony=obits  Onslaught=WSJ  Elden Ring=game
empty       Margie Claus  Iliya Muromets  Se Eu Fosse Você 3   (no recent EN news)
```
