import { useIsFollowing, useToggleFollow } from "@/api/me";
import type { FollowTarget } from "@/lib/film-entities";
import { Button } from "@/components/ui/button";
import { LockedToggle, SignInToggle, useFollowAccess } from "./access";

/** Follow or unfollow one entity — a person, a company, a franchise or the title itself.
 *
 *  Takes a resolved {@link FollowTarget}: a caller with an entity the payload cannot identify
 *  renders nothing at all rather than a button that would have nothing to follow, so the
 *  decision stays at the one place that knows the entity (see `lib/film-entities.ts`). */
export function FollowButton({ target }: { target: FollowTarget }) {
  const access = useFollowAccess();
  const following = useIsFollowing(target);
  const toggle = useToggleFollow();

  const label = following ? "Following" : "Follow";
  const name = following ? `Unfollow ${target.label}` : `Follow ${target.label}`;

  if (access === "anonymous") {
    return <SignInToggle label={label} name={`Sign in to follow ${target.label}`} />;
  }
  if (access === "locked") return <LockedToggle label={label} name={name} />;

  return (
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
  );
}
