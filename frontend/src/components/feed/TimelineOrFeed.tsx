import type { FeedDayResponse } from "@/api/types";
import { useFollowAccess } from "@/components/follow/access";
import { GlobalFeed } from "@/components/feed/GlobalFeed";
import { TimelinePage } from "@/components/feed/TimelinePage";

/**
 * What `/` renders, decided on the client (NEU-1354, D-12).
 *
 * The server render never resolves auth — the `["me"]` query is client-only, which is what keeps
 * `/` an anonymous-safe document (`routes/public-layout.tsx`). So the loader always loads the
 * global feed and this island decides what to do with it once the account lands:
 *
 * - **ready** — signed in and entitled. Swap to their own feed.
 * - **hinted** — no account yet, but the timeline hint predicts a `ready` one (NEU-1468,
 *   ADR-0001). The same page, which can only show its skeleton until the account lands, and is
 *   server-rendered that way, so a subscriber's first paint is already "My feed". A hint that
 *   turns out wrong falls through to the global feed below with no extra request: it was loaded
 *   all along.
 * - **anything else** — anonymous, or signed in without a grant. The global feed, rendered
 *   exactly as `/feed` renders it.
 *
 * That second branch used to carry an extra panel: a "Sign in to see a timeline" line for
 * anonymous visitors, and a "Your timeline is not open yet" panel for signed-in ones. Both are
 * gone (NEU-1410). Sign-in now lives only in the header's account menu, and the locked panel's
 * copy — which said outright that there was nothing to buy yet — is replaced by the real
 * subscription offer in NEU-1409, shown to everyone unentitled on both routes rather than to
 * one group on one route.
 *
 * What is left is worth stating plainly: for a reader without a grant, `/` and `/feed` now
 * render the same thing. `GlobalFeed` owns its own heading so they cannot drift.
 */
export function TimelineOrFeed({ feed }: { feed: FeedDayResponse }) {
  const access = useFollowAccess();

  if (access === "ready" || access === "hinted") return <TimelinePage />;
  return <GlobalFeed feed={feed} />;
}
