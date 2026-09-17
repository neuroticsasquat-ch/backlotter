import { useIsOnWatchlist, useToggleWatchlist } from "@/api/me";
import type { WatchlistFilm } from "@/api/types";
import { Button } from "@/components/ui/button";
import { LockedToggle, SignInToggle, useFollowAccess } from "./access";

/** Put the film on the watchlist, or take it off. Off is not merely a delete: the backend
 *  records a dismissal for an item the follow graph derived, so removing it here keeps it from
 *  being derived back (D-13). Alert preferences are the watchlist page's business, not this
 *  toggle's — an item added here takes the default, `{stream}` (D-14). */
export function WatchlistButton({ film }: { film: WatchlistFilm }) {
  const access = useFollowAccess();
  const onList = useIsOnWatchlist(film.id);
  const toggle = useToggleWatchlist();

  const label = onList ? "On watchlist" : "Watchlist";
  const name = onList
    ? `Remove ${film.title} from your watchlist`
    : `Add ${film.title} to your watchlist`;

  if (access === "anonymous") {
    return <SignInToggle label={label} name={`Sign in to add ${film.title} to your watchlist`} />;
  }
  if (access === "locked") return <LockedToggle label={label} name={name} />;

  return (
    <Button
      size="sm"
      variant={onList ? "secondary" : "default"}
      aria-label={name}
      aria-pressed={onList}
      disabled={toggle.isPending}
      onClick={() => toggle.mutate({ film, onList })}
    >
      {label}
    </Button>
  );
}
