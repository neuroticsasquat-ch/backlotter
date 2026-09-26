import { Check } from "lucide-react";
import { useIsFollowing, useToggleFollow } from "@/api/me";
import type { EntityResult } from "@/api/entities";
import type { FollowTarget } from "@/lib/film-entities";
import { profileUrl } from "@/lib/poster";

/**
 * One face in the onboarding grid, which is the follow control rather than carrying one
 * (D-17: "tap to follow"). The whole card is the button, so a thumb aimed anywhere near a name
 * follows it; the entity pages' separate {@link FollowButton} stays as it is, because a page
 * is not a thing you can tap.
 *
 * A toggle, not a one-way add: the tap that follows the wrong Chris has to be undoable by the
 * same tap, and `aria-pressed` is what says which state it is in.
 *
 * `w-full h-full` pin the card to its grid cell: a `<button>` shrink-fits to its content even as
 * a flex box, so without them a long name widened the card and its photo with it (NEU-1471).
 */
export function PersonTile({ person }: { person: EntityResult }) {
  const target: FollowTarget = {
    entityType: person.entityType,
    entityId: person.entityId,
    label: person.label,
    imagePath: person.imagePath,
  };
  const following = useIsFollowing(target);
  const toggle = useToggleFollow();
  const image = profileUrl(person.imagePath, "w185");

  return (
    <button
      type="button"
      aria-pressed={following}
      aria-label={following ? `Unfollow ${person.label}` : `Follow ${person.label}`}
      onClick={() => toggle.mutate({ target, following })}
      className={`group relative flex h-full w-full flex-col overflow-hidden rounded-lg border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        following ? "border-primary bg-primary/5" : "border-border hover:border-foreground/40"
      }`}
    >
      {image ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          className="aspect-[2/3] w-full object-cover"
          // A face the user has not followed is dimmed rather than the followed one being
          // highlighted, so a grid of thirty reads as "these two are picked" at a glance.
          style={following ? undefined : { filter: "grayscale(0.4)" }}
        />
      ) : (
        <div aria-hidden="true" className="aspect-[2/3] w-full bg-muted" />
      )}
      {following && (
        // The state is already spoken by aria-pressed; the badge is for the eye only.
        <span
          aria-hidden="true"
          data-testid="picked"
          className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm"
        >
          <Check className="size-3" />
        </span>
      )}
      <span className="flex flex-col gap-0.5 p-2">
        <span className="line-clamp-2 text-xs font-medium break-words text-foreground">
          {person.label}
        </span>
        {person.secondary && (
          <span className="truncate text-[11px] text-muted-foreground">{person.secondary}</span>
        )}
      </span>
    </button>
  );
}
