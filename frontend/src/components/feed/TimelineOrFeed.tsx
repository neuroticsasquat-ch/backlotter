import type { FeedDayResponse } from "@/api/types";
import { useFollowAccess } from "@/components/follow/access";
import { GlobalFeed } from "@/components/feed/GlobalFeed";
import { TimelinePage } from "@/components/feed/TimelinePage";

/**
 * What `/` renders, decided on the client (NEU-1354, D-12).
 *
 * The server render never resolves auth — the `["me"]` query is client-only, which is what keeps
 * `/` a single cacheable, anonymous-safe document (`routes/public-layout.tsx`). So the loader
 * always SSRs the global feed and this island decides what to do with it once the account lands:
 *
 * - **ready** — signed in and entitled. Swap to their own feed.
 * - **anything else** — anonymous, or signed in without a grant. The SSR'd global feed, rendered
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

  if (access === "ready") return <TimelinePage />;
  return <GlobalFeed feed={feed} />;
}
