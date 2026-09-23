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
 * It stays a component of its own rather than collapsing into that one because NEU-1444 is
 * about to give the person page a Recent activity section fed from the same follow; the seam
 * is where that lands.
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
          onClick={() => toggle.mutate({ target, following })}
        >
          {label}
        </Button>
      )}
    </div>
  );
}
