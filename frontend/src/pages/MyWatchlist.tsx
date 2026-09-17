import { Link } from "react-router";
import { useToggleWatchlist, useWatchlist } from "@/api/me";
import type { AlertPref, WatchlistItem } from "@/api/types";
import { AlertPrefChips } from "@/components/follow/AlertPrefChips";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatHeadlineRelease } from "@/lib/format";
import { posterSrcSet, posterUrl } from "@/lib/poster";

/**
 * The film's URL ref. `WatchlistFilmOut` carries no `ref`, so this uses the bare TMDB id —
 * always a valid ref, which `/film/:ref` resolves and then 301s to the canonical
 * `<tmdb_id>-<title-slug>` form. Re-deriving that slug here would mean keeping a copy of the
 * backend's `slugify` in step with it, and a drifted copy would mint wrong links rather than
 * slow ones.
 */
const filmRef = (item: WatchlistItem) => String(item.film.tmdb_id);

/** A derived item is one the follow graph added (D-13), and removing it is a different act
 *  from removing one the user added by hand — the dismissal it writes is permanent. */
const isDerived = (item: WatchlistItem) => item.source === "derived_from_follow";

function WatchlistRow({ item }: { item: WatchlistItem }) {
  const toggle = useToggleWatchlist();
  const { film } = item;
  const poster = posterUrl(film.poster_path, "w92");
  const derived = isDerived(item);

  const remove = () => toggle.mutate({ film, onList: true });

  const removeButton = (
    <Button
      size="sm"
      variant="outline"
      aria-label={`Remove ${film.title} from your watchlist`}
      disabled={toggle.isPending}
      // A manual item just goes; the derived one routes through the confirm below, which owns
      // the click instead.
      onClick={derived ? undefined : remove}
    >
      Remove
    </Button>
  );

  return (
    <li className="flex gap-3 py-3">
      <Link to={`/film/${filmRef(item)}`} className="flex-none">
        {poster ? (
          <img
            src={poster}
            srcSet={posterSrcSet(film.poster_path) ?? undefined}
            sizes="48px"
            alt=""
            loading="lazy"
            className="h-[72px] w-12 rounded object-cover"
          />
        ) : (
          <div aria-hidden="true" className="h-[72px] w-12 rounded bg-muted" />
        )}
      </Link>

      <div className="min-w-0 flex-1">
        <Link
          to={`/film/${filmRef(item)}`}
          className="text-sm font-medium text-foreground hover:underline"
        >
          {film.title}
        </Link>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatHeadlineRelease(film.headline_release)}
          {derived ? " · added by a follow" : ""}
        </p>
        <div className="mt-2">
          <AlertPrefChips
            filmId={film.id}
            title={film.title}
            prefs={item.alert_prefs as AlertPref[]}
          />
        </div>
      </div>

      <div className="flex-none self-start">
        {derived ? (
          <ConfirmDialog
            trigger={removeButton}
            title="Remove this film?"
            description={`${film.title} was added because of someone you follow. Removing it keeps it off your watchlist for good — following more of their work will not bring it back.`}
            confirmLabel="Remove"
            onConfirm={remove}
          />
        ) : (
          removeButton
        )}
      </div>
    </li>
  );
}

/**
 * `/me/watchlist` — the films the user will be alerted about.
 *
 * Two sources land here (D-13): films added by hand, and films the follow graph derived from a
 * director, top-3 billing, company, collection or title follow. The distinction is visible
 * because removal differs — taking a derived film off writes a dismissal that blocks it being
 * derived again, permanently, which is worth a confirm that a manual removal is not.
 *
 * Nothing prunes on load (D-40), including items whose film has no date yet.
 */
export function MyWatchlist() {
  const { data, isLoading, isError, error } = useWatchlist();
  const items = data?.items ?? [];

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Watchlist</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        We tell you when one of these gets a date, moves, or turns up to buy, rent or stream. Date
        changes and trailers are always on; the chips choose which store alerts you want.
      </p>

      {isLoading && <p className="mt-6 text-muted-foreground">Loading your watchlist…</p>}

      {isError && (
        <p className="mt-6 text-red-600">
          Failed to load your watchlist{error instanceof Error ? `: ${error.message}` : ""}.
        </p>
      )}

      {data && items.length === 0 && (
        <p className="mt-6 text-muted-foreground">
          Your watchlist is empty. Add a film from its page, or{" "}
          <Link to="/me/follows" className="underline underline-offset-4 hover:text-foreground">
            follow a director or studio
          </Link>{" "}
          and we will fill it in for you.
        </p>
      )}

      {items.length > 0 && (
        <ul className="mt-6 divide-y divide-border">
          {items.map((item) => (
            <WatchlistRow key={item.film.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default MyWatchlist;
