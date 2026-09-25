import { useFollow, useToggleFollow } from "@/api/me";
import { Button } from "@/components/ui/button";
import type { FollowTarget } from "@/lib/film-entities";
import { LockedToggle, SignInToggle, useFollowAccess } from "./access";

/**
 * The person page's follow control.
 *
 * It used to be the button *and* the tier it followed at, because a person was the one entity
 * whose follow could be narrowed. A follow is binary now (EF-1) — the three-tier
 * `CoverageControl`, the local state the first follow was created at and the PATCH that
 * changed one afterwards are all gone — so what is left is the button and the access states
 * around it, and this is the film page's {@link FollowButton} in all but its access wiring.
 *
 * The seam it was held open for has closed: NEU-1444's Recent activity section reads the
 * entity's own `/events` route rather than the follow, so it hangs off the page beside the
 * film lists and not off this control. What is left here is the flex wrapper the header's
 * spacing wants; the day anything needs a second control beside the button is the day this
 * earns its own file again.
 */
export function PersonFollowControl({ target }: { target: FollowTarget }) {
  const access = useFollowAccess();
  const follow = useFollow(target);
  const toggle = useToggleFollow();

  const following = follow !== null;
  const label = following ? "Following" : "Follow";
  const name = following ? `Unfollow ${target.label}` : `Follow ${target.label}`;

  return (
    <div className="flex flex-col items-start gap-1.5">
      {/* `hinted` is still no account: the hint only shapes the home page and the nav. */}
      {(access === "anonymous" || access === "hinted") && (
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
          onClick={() => toggle.mutate({ target, following })}
        >
          {label}
        </Button>
      )}
    </div>
  );
}
