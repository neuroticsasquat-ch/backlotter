import { Link } from "react-router";
import { useToggleWatchlist, useWatchlist } from "@/api/me";
import type { WatchlistItem } from "@/api/types";
import { Button } from "@/components/ui/button";
import { coveredBeyondTitleFollow, isDirectTitleCover } from "@/lib/film-entities";
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

/**
 * How this film got here, in one phrase (D-42).
 *
 * The two ways are not exclusive and the row says both when both hold: a film can be one the
 * user asked for *and* one their follows would have reached anyway, and "followed · via
 * Christopher Nolan" is the only rendering that survives unfollowing either one honestly. The
 * direct title follow is dropped from the "via" list — naming the film as the reason it is
 * here says nothing.
 */
function coverageSummary(item: WatchlistItem): string {
  const parts: string[] = [];
  if (item.followed) parts.push("followed");

  const indirect = item.covered_by.filter((cover) => !isDirectTitleCover(cover, item.film.id));
  // A cover the backend could not name is still a cover (D-40 keeps the follow), so it counts
  // towards "and 2 more" rather than being dropped — but it is never the name shown.
  const named = indirect.find((cover) => cover.name);
  if (named) {
    const others = indirect.length - 1;
    parts.push(others > 0 ? `via ${named.name} and ${others} more` : `via ${named.name}`);
  } else if (indirect.length > 0) {
    parts.push("via someone you follow");
  }

  return parts.join(" · ");
}

/**
 * What pressing the row's button actually does, said in the word for it.
 *
 * *Stop* is two acts wearing one endpoint: the film stays on the list, muted, when another
 * follow still covers it, and leaves outright when the user's own title follow was the only
 * thing holding it there. Calling the second one "Mute" would promise an undo that the Muted
 * section below will not have — the row is simply gone — so it says "Unfollow" instead.
 */
function rowAction(item: WatchlistItem): "Unmute" | "Mute" | "Unfollow" {
  if (item.muted) return "Unmute";
  return coveredBeyondTitleFollow(item.covered_by, item.film.id) ? "Mute" : "Unfollow";
}

function WatchlistRow({ item, muted }: { item: WatchlistItem; muted: boolean }) {
  const toggle = useToggleWatchlist();
  const { film } = item;
  const poster = posterUrl(film.poster_path, "w92");
  const reason = coverageSummary(item);
  const action = rowAction(item);

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
          {reason ? ` · ${reason}` : ""}
        </p>
      </div>

      <div className="flex-none self-start">
        <Button
          size="sm"
          variant="outline"
          aria-label={`${action} ${film.title}`}
          disabled={toggle.isPending}
          onClick={() => toggle.mutate({ film, onList: !muted })}
        >
          {action}
        </Button>
      </div>
    </li>
  );
}

/**
 * `/me/watchlist` — the films the user will be alerted about.
 *
 * Not a list they maintain: it is the computed set of in-play films their follows cover for
 * alerts, minus the ones they muted (D-42). So every row says how it got here, there is
 * nothing to add from this page, and taking a film off is a mute — reversible, undone from the
 * Muted section at the bottom, and not worth a confirm.
 *
 * Nothing prunes on load (D-40), including items whose film has no date yet.
 */
export function MyWatchlist() {
  const { data, isLoading, isError, error } = useWatchlist();
  const items = data?.items ?? [];
  const live = items.filter((item) => !item.muted);
  const muted = items.filter((item) => item.muted);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Watchlist</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        We tell you when one of these gets a date, moves, or turns up to watch at home. Films get
        here from what you follow; mute one to stop hearing about it.
      </p>

      {isLoading && <p className="mt-6 text-muted-foreground">Loading your watchlist…</p>}

      {isError && (
        <p className="mt-6 text-red-600">
          Failed to load your watchlist{error instanceof Error ? `: ${error.message}` : ""}.
        </p>
      )}

      {/* Every film muted is not an empty watchlist: the follows that cover them are still
          there, so the page owes the reader the Muted section and its undo, not an invitation
          to go and follow something. */}
      {data && items.length === 0 && (
        <p className="mt-6 text-muted-foreground">
          Your watchlist is empty. Follow a film from its page, or{" "}
          <Link to="/me/follows" className="underline underline-offset-4 hover:text-foreground">
            follow a director or studio
          </Link>{" "}
          and we will fill it in for you.
        </p>
      )}

      {live.length > 0 && (
        <ul className="mt-6 divide-y divide-border">
          {live.map((item) => (
            <WatchlistRow key={item.film.id} item={item} muted={false} />
          ))}
        </ul>
      )}

      {muted.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold text-foreground">Muted</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Still covered by what you follow, but we stay quiet about them. Unmute one to start
            hearing about it again.
          </p>
          <ul className="mt-1 divide-y divide-border">
            {muted.map((item) => (
              <WatchlistRow key={item.film.id} item={item} muted />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default MyWatchlist;
