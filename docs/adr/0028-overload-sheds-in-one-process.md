# ADR-0028 — The API sheds overload in one process instead of adding workers

**Status:** Accepted 2026-11-10 (NEU-2271) · **Spec:** `../specs/NEU-2271-db-pool-fail-fast.md`

## Context

A crawl burst (Lightpanda, 2026-11-09 and -10) sent a few hundred SSR page loads at the API in
three minutes. Prod runs one uvicorn process on an 8-core host. Person reads take ~50–150 ms
unloaded, yet requests waited the full 30 s for one of the pool's 15 connections and failed as
500s (`../measurements/2026-11-10-neu-2271-pool-baseline.md`). Each request's session held its
connection until the request ended, so a saturated process kept connections checked out long
after their queries finished.

Adding uvicorn workers is the obvious way to use the idle cores, and it was rejected.

## Decision

The API stays **one process** and handles overload by **holding connections only as long as
their queries** and **failing fast**:

- Public read routes end their transaction once the service returns, before the response is built
  and sent.
- The pool is explicit and sized against the dedicated Postgres's `max_connections`, with a short
  checkout timeout.
- A pool checkout timeout answers **503 with `Retry-After`**. Overload is a client-retryable
  condition, not a server fault.

## Why not more workers

- **The rate limiter is in-process.** `app/rate_limit.py` keeps per-IP token buckets in memory.
  With N workers each visitor gets N independent buckets, and which one a request hits depends on
  the worker that happens to accept it. Every limit becomes roughly N× and nondeterministic.
- **Lifespan work is per process.** `lifespan` cancels runs orphaned by a crash and opens the
  process-wide `MailGateway`. Under N workers the orphan sweep runs N times concurrently at boot.
- **Connections multiply.** Each worker has its own pool, so N workers need N× the connection
  budget against the same `max_connections` — with no overload handling added.

## Consequences

- Throughput is bounded by one core. If a measured burst shows the process itself (not the pool)
  saturating after this change, revisit with a shared rate-limit store first; that is what makes
  workers safe.
- Edge caching of public pages is the bigger lever against crawls. It is separate work: the
  server-rendered document varies on `timeline_hint` (ADR-0026).
- Clients see 503s during a burst. The frontend's loaders treat a 503 like any other failure
  today; rendering a "busy" page is a follow-up.
