# ADR-0001 — A first-party timeline hint picks the shell `/` server-renders

**Status:** Accepted 2026-09-25 (NEU-1468) · **Amends:** D-12 of the Consumer Pivot project spec
(`../backend/docs/specs/bl-consumer-pivot-project-spec.md`) and `NEU-1354-home-timeline-swap.md`

## Context

`/` is the reader's timeline when they are signed in and entitled, and the global feed
otherwise (D-12). The frontend is server-rendered on a Cloudflare Worker under an invariant:
**the server never resolves auth**. The `["me"]` query runs only on the client, so the SSR
document and the first client paint are always the anonymous page, and a client island swaps to
the timeline once `/me` answers. NEU-1354 chose this over forwarding the session cookie to the
loader, which would make `/` per-user and uncacheable, and which is not even possible as things
stand: the session cookie is host-only on the API origin and the Worker cannot see it.

The consequence is that every full load of `/` by a subscriber paints "All updates" first, then
the "My feed" skeleton, then the timeline, and the header nav flips with it. The post-login
landing does the same because the public layout's query client is cold or stale.

## Decision

The browser writes itself a **timeline hint**: a first-party cookie `timeline_hint=1` on the
site origin, set whenever the account resolves entitled, cleared whenever it resolves anonymous
or unentitled, or on logout. It is 30 days, sliding, `SameSite=Lax`, `Secure` on https, and its
value carries nothing.

A loader on the public layout reads the hint from the request's `Cookie` header and exposes it
to the subtree. `useFollowAccess()` gains a fourth state, `hinted`: no user yet, hint present,
account read in flight. `TimelineOrFeed` renders the timeline skeleton for it and the nav
renders its two-item form; every other consumer treats it as `anonymous`. `/` still loads the
global feed on every request so a stale hint falls back to it instantly, and the timeline
request stays gated on a resolved, entitled account.

D-12's "`/` always server-renders the global feed" is amended to: `/` always **loads** the
global feed and server-renders either it or the timeline skeleton, chosen by the hint. Auth is
still never resolved server-side.

## Consequences

- No flash of the anonymous page for a reader whose last resolve was entitled, on a full load
  or after login. The anonymous page is unchanged: without the hint nothing differs.
- The hint is a prediction, not a credential. A stale one costs a skeleton-to-feed swap; a
  forged one gets a skeleton and then the global feed. It grants nothing and is never sent to
  the API.
- The SSR document now varies on one cookie. `/` is not edge-cached today (nothing sets
  `Cache-Control` on it); if it ever is, the cache key must vary on `timeline_hint`.
- Two paths read the hint: loader data under the public layout, `document.cookie` in the SPA
  subtree, which is client-only. Both agree with what the server rendered by construction, so
  there is no hydration mismatch to manage.
- The header's avatar island, the calendar's tab strip and the follow buttons keep their
  anonymous rendering until `/me` answers. They are the same flicker class and can adopt
  `hinted` later without touching this decision.
