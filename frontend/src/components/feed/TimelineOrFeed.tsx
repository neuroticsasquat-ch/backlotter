import { Link } from "react-router";
import type { FeedDayResponse } from "@/api/types";
import { useFollowAccess } from "@/components/follow/access";
import { GlobalFeed } from "@/components/feed/GlobalFeed";
import { TimelinePage } from "@/components/feed/TimelinePage";

/** The home page's heading when it is showing the global feed. Unchanged from before the swap:
 *  it is what search engines index, and only the anonymous render is indexed. */
const GLOBAL_FEED_HEADING = "Latest Updates for Upcoming Movies";

/**
 * What `/` renders, decided on the client (NEU-1354, D-12).
 *
 * The server render never resolves auth — the `["me"]` query is client-only, which is what keeps
 * `/` a single cacheable, anonymous-safe document (`routes/public-layout.tsx`). So the loader
 * always SSRs the global feed and this island decides what to do with it once the account lands:
 *
 * - **anonymous** (also every server render and first client paint, and the moment while `me` is
 *   still in flight) — the SSR'd feed exactly as before, plus one line offering the timeline.
 *   No spinner: the anonymous experience must not regress into a flash of loading state.
 * - **locked** — signed in, not granted access (D-37/D-41). Still the SSR'd feed, with a panel
 *   above it saying what a timeline is and why they haven't got one yet.
 * - **ready** — signed in and entitled. Swap to the timeline.
 *
 * The three-way split is `useFollowAccess`, the same hook the follow buttons branch on, so a
 * grant taking effect flips this page and those buttons in the same render.
 */
export function TimelineOrFeed({ feed }: { feed: FeedDayResponse }) {
  const access = useFollowAccess();

  if (access === "ready") return <TimelinePage />;

  return (
    <GlobalFeed
      feed={feed}
      heading={GLOBAL_FEED_HEADING}
      intro={access === "locked" ? <LockedTimelinePanel /> : <SignInToTimeline />}
    />
  );
}

/** The anonymous line under the heading. Small and muted, and rendered on the server too, so it
 *  costs no layout shift and cannot mismatch on hydration. */
function SignInToTimeline() {
  return (
    <p className="mt-1 text-sm text-muted-foreground">
      <Link to="/login?next=/" className="underline underline-offset-4 hover:text-foreground">
        Sign in
      </Link>{" "}
      to see a timeline of the people you follow.
    </p>
  );
}

/**
 * The signed-in-but-not-entitled state (D-41). Explains and stops.
 *
 * Deliberately not the empty-timeline card: that one tells a reader to go and follow things, and
 * this reader would be refused when they tried. It is also not an upsell — there is nothing to
 * buy until the subscription tier ships — so it offers no action at all beyond the feed already
 * below it.
 */
function LockedTimelinePanel() {
  return (
    <section
      aria-labelledby="locked-timeline-heading"
      className="mt-4 rounded-lg border border-border bg-muted/40 p-4"
    >
      <h2 id="locked-timeline-heading" className="text-sm font-semibold text-foreground">
        Your timeline is not open yet
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        A timeline is this feed narrowed to the people, studios and films you follow — every update
        about them, and nothing else. Following is part of the subscription, and access is limited
        while we build that tier.
      </p>
      <p className="mt-1.5 text-sm text-muted-foreground">
        In the meantime, here is everything we track.
      </p>
    </section>
  );
}
