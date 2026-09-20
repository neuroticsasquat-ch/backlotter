import { useToggleWatchlist, useWatchlistItem } from "@/api/me";
import type { WatchlistFilm, WatchlistItem } from "@/api/types";
import { Button } from "@/components/ui/button";
import { LockedToggle, SignInToggle, useFollowAccess } from "./access";

/** The three things the one control can be saying, read off the film's watchlist row. */
type State = "absent" | "muted" | "following";

const state = (item: WatchlistItem | null): State =>
  item === null ? "absent" : item.muted ? "muted" : "following";

const LABELS: Record<State, string> = {
  absent: "Follow",
  muted: "Muted",
  following: "Following",
};

const VARIANTS: Record<State, "default" | "outline" | "secondary"> = {
  absent: "default",
  muted: "outline",
  following: "secondary",
};

/**
 * The film page's one control: *will I hear about this film?*
 *
 * It replaces the Watchlist/Follow pair the page used to carry. Those were two records with
 * one meaning — a title follow already implied a watchlist item on every path but this button
 * — and they came apart in ways nobody designed: unfollowing left the item, removing the item
 * left the follow plus a permanent dismissal, and a hand-watchlisted film never reached the
 * timeline at all (ADR-0018, D-42).
 *
 * **Keyed on the watchlist item, never on `["me","follows"]`.** The title follow is an
 * implementation detail of *want* that the backend owns: a press creates one only where
 * nothing else already covers the film, and *stop* mutes rather than deletes where something
 * does (D-45). Reading the follow list here would make the button disagree with itself for a
 * film reached through a director.
 *
 * Person, company and franchise follows keep their own {@link FollowButton}. They mean what
 * they say, and the coverage tier they take is the follows page's business (NEU-1415).
 */
export function TitleFollowButton({ film }: { film: WatchlistFilm }) {
  const access = useFollowAccess();
  const item = useWatchlistItem(film.id);
  const toggle = useToggleWatchlist();

  const current = state(item);
  const label = LABELS[current];
  const name = {
    absent: `Follow ${film.title}`,
    muted: `Hear about ${film.title} again`,
    following: `Stop hearing about ${film.title}`,
  }[current];

  // Both of these read the *absent* copy outright rather than `label`/`name`, which are
  // derived from the watchlist item. Neither state has an item to derive from — `useWatchlist`
  // is gated on `user?.entitled`, so it never resolves for them — but a cache left warm by a
  // grant that lapsed mid-session would make a disabled button say "Following", which is the
  // one thing a locked control must not claim. The spec pins this copy for that reason.
  if (access === "anonymous") {
    return <SignInToggle label={LABELS.absent} name={`Sign in to follow ${film.title}`} />;
  }
  if (access === "locked") {
    return <LockedToggle label={LABELS.absent} name={`Follow ${film.title}`} />;
  }

  return (
    <>
      <Button
        size="sm"
        variant={VARIANTS[current]}
        aria-label={name}
        // Only the middle state is "on". A muted film is on the computed list and
        // deliberately does not count — muting is how you stop hearing about a film you are
        // still covered for, so a pressed state read from presence alone would say "on" for a
        // film it had just silenced.
        aria-pressed={current === "following"}
        disabled={toggle.isPending}
        // `onList` is the state the film is in *now*, so the mutation moves it to the other
        // one: *want* from absent or muted, *stop* from following.
        onClick={() => toggle.mutate({ film, onList: current === "following" })}
      >
        {label}
      </Button>
      <FollowReason item={item} />
    </>
  );
}

/**
 * Why a film the user never asked for is on their list — "via Christopher Nolan".
 *
 * Only for a film they did *not* follow directly: `followed` means they chose this one, and
 * naming a director beside their own choice would explain a decision they already remember
 * making. A muted row says nothing either; the button already reads "Muted", and the reason it
 * would still be covered is not what that reader wants to know.
 *
 * `covered_by` arrives direct-title-follow-first from the backend, so index 0 is the name to
 * show. A cover the backend could not resolve carries a null name (D-40 keeps the follow), so
 * an unnameable first cover renders nothing rather than "via null".
 */
function FollowReason({ item }: { item: WatchlistItem | null }) {
  if (!item || item.muted || item.followed) return null;
  const [first, ...rest] = item.covered_by;
  if (!first?.name) return null;
  return (
    <span className="text-sm text-muted-foreground">
      via {first.name}
      {rest.length > 0 ? ` and ${rest.length} more` : ""}
    </span>
  );
}
