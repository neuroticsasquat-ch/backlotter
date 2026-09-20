import { useIsOnWatchlist, useToggleWatchlist } from "@/api/me";
import type { WatchlistFilm } from "@/api/types";
import { Button } from "@/components/ui/button";
import { LockedToggle, SignInToggle, useFollowAccess } from "./access";

/** Put the film on the watchlist, or take it off. Neither is a plain insert or delete: the
 *  watchlist is computed from the user's follows (D-42), so *on* creates a title follow where
 *  nothing else covers the film and *off* mutes it where something still does (D-45). There
 *  are no per-film alert preferences to set here — the stores are one account setting
 *  (`/settings`, D-44). NEU-1405 replaces this pair with a single control. */
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
