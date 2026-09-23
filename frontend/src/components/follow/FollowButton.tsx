import { useIsFollowing, useToggleFollow } from "@/api/me";
import type { FollowTarget } from "@/lib/film-entities";
import { Button } from "@/components/ui/button";
import { LockedToggle, SignInToggle, useFollowAccess } from "./access";

/** How loudly the button asks. `quiet` is the default and what every row control uses — an
 *  outline that sits inside a list without competing with it. `primary` is for the one button
 *  that is the page's reason to be there — today only the film page's title follow (EF-16),
 *  where it is the one control left: a filled button, so the page has a single obvious
 *  action. The entity pages draw the `quiet` one inside their header. The
 *  distinction is only in the *unfollowed* state; once followed, both read as `secondary`,
 *  because a done thing should stop shouting. */
export type FollowEmphasis = "quiet" | "primary";

/** Follow or unfollow one entity — a person, a company, a franchise or the title itself.
 *
 *  Takes a resolved {@link FollowTarget}: a caller with an entity the payload cannot identify
 *  renders nothing at all rather than a button that would have nothing to follow, so the
 *  decision stays at the one place that knows the entity (see `lib/film-entities.ts`). */
export function FollowButton({
  target,
  emphasis = "quiet",
}: {
  target: FollowTarget;
  emphasis?: FollowEmphasis;
}) {
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
      variant={following ? "secondary" : emphasis === "primary" ? "default" : "outline"}
      aria-label={name}
      aria-pressed={following}
      disabled={toggle.isPending}
      onClick={() => toggle.mutate({ target, following })}
    >
      {label}
    </Button>
  );
}
