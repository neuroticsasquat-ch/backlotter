import { useState } from "react";
import { useFollow, useToggleFollow, useUpdateFollowCoverage } from "@/api/me";
import type { FollowCoverage } from "@/api/types";
import { Button } from "@/components/ui/button";
import type { FollowTarget } from "@/lib/film-entities";
import { CoverageControl } from "./CoverageControl";
import { LockedToggle, SignInToggle, useFollowAccess } from "./access";

/**
 * The person page's follow control: the button, and the tier it follows at, together.
 *
 * Not the film page's bare {@link FollowButton}. There, `lead` is the sensible default for a
 * row that *is* a lead credit and the tier is a detail to change later on `/me/follows`. Here
 * the page is already showing the reader that "Lead roles" reaches two of seven films, so the
 * choice is the point and the control is always visible — before the follow exists as well as
 * after (D-1416.8).
 *
 * Which makes the tier two different things either side of the follow. Before it, there is
 * nothing to PATCH: the value is local state and the follow is *created* at it. After, the
 * follow is the truth — read back from the cached list, so a change made on `/me/follows` in
 * another tab shows up here — and a change is a PATCH. The local state stays untouched across
 * the boundary so that unfollowing and following again does not silently reset the reader's
 * choice to `lead`.
 */
export function PersonFollowControl({ target }: { target: FollowTarget }) {
  const access = useFollowAccess();
  const follow = useFollow(target);
  const toggle = useToggleFollow();
  const updateCoverage = useUpdateFollowCoverage();
  const [pending, setPending] = useState<FollowCoverage>("lead");

  const following = follow !== null;
  const coverage = follow?.coverage ?? pending;
  const label = following ? "Following" : "Follow";
  const name = following ? `Unfollow ${target.label}` : `Follow ${target.label}`;

  const change = (next: FollowCoverage) => {
    setPending(next);
    if (follow) updateCoverage.mutate({ follow, coverage: next });
  };

  return (
    <div className="flex flex-col items-start gap-1.5">
      {access === "anonymous" && (
        <SignInToggle label={label} name={`Sign in to follow ${target.label}`} />
      )}
      {access === "locked" && <LockedToggle label={label} name={name} />}
      {access === "ready" && (
        <Button
          size="sm"
          variant={following ? "secondary" : "outline"}
          aria-label={name}
          aria-pressed={following}
          disabled={toggle.isPending}
          // `coverage` rides on the create and is ignored by the delete, so the reader's
          // chosen tier lands with the follow rather than as a PATCH a moment after it.
          onClick={() => toggle.mutate({ target, following, coverage })}
        >
          {label}
        </Button>
      )}
      {/* Rendered in every access state, disabled in the two that cannot act: someone deciding
          whether they want a subscription should be able to see what it would let them pick,
          for the reason `LockedToggle` is disabled rather than hidden (D-41). */}
      <CoverageControl
        value={coverage}
        onChange={change}
        label={target.label}
        disabled={access !== "ready" || updateCoverage.isPending}
      />
    </div>
  );
}
