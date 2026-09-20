import { Link } from "react-router";
import { useFollows, useToggleFollow, useUpdateFollowCoverage } from "@/api/me";
import type { Follow, FollowEntityType } from "@/api/types";
import { CoverageControl } from "@/components/follow/CoverageControl";
import { FollowEntitySearch } from "@/components/follow/FollowEntitySearch";
import { Button } from "@/components/ui/button";
import { personPath, type FollowTarget } from "@/lib/film-entities";
import { formatEventDate } from "@/lib/format";
import { profileUrl } from "@/lib/poster";

/** The groups, in the order they appear. Fixed rather than derived from the data so the page
 *  does not reshuffle its headings as the user follows things. */
const GROUPS: { type: FollowEntityType; heading: string; note?: string }[] = [
  // The note answers the obvious misreading of the coverage radios below — that narrowing them
  // empties the timeline too. Once, on the group, rather than on every person row. The last
  // sentence is not a flourish: `any` is the one tier that moves the timeline as well as the
  // alerts (D-47), and a note that stopped at "this only narrows your alerts" would now be
  // wrong about a third of its own control.
  {
    type: "person",
    heading: "People",
    note: "Lead roles and Major credits narrow what we alert you about; your timeline shows every major credit either way. Every credit widens both.",
  },
  { type: "company", heading: "Companies" },
  { type: "franchise", heading: "Collections" },
  { type: "title", heading: "Films" },
];

/** Where a follow came from, shown only when it is not the user's own click — "manual" is the
 *  default and saying so on every row would be noise. */
const SOURCE_LABELS: Record<string, string> = {
  letterboxd_import: "from Letterboxd import",
  tmdb_import: "from TMDB import",
  derived: "added automatically",
};

/** The TMDB page for a followed entity, the fallback identification for a row whose name this
 *  browser never learned. People are absent: they have a page of ours now (NEU-1419) and the
 *  row links its name there whether or not we know it, which is a better answer than TMDB —
 *  it says what they have coming and carries the same coverage control. Companies and
 *  collections keep the outbound link until they get pages of their own; `title` follows are
 *  film UUIDs, which TMDB cannot address, so they get none. */
function tmdbUrl(follow: Follow): string | null {
  switch (follow.entity_type) {
    case "company":
      return `https://www.themoviedb.org/company/${follow.entity_id}`;
    case "franchise":
      return `https://www.themoviedb.org/collection/${follow.entity_id}`;
    default:
      return null;
  }
}

const PLACEHOLDER: Record<FollowEntityType, string> = {
  person: "Person",
  company: "Company",
  franchise: "Collection",
  title: "Film",
};

/**
 * The shared {@link CoverageControl}, bound to a follow that already exists: every change is a
 * PATCH, because there is no state before the follow here the way there is on a person page.
 */
function FollowCoverageControl({ follow, label }: { follow: Follow; label: string }) {
  const update = useUpdateFollowCoverage();
  return (
    <CoverageControl
      className="mt-1"
      value={follow.coverage}
      onChange={(coverage) => update.mutate({ follow, coverage })}
      label={label}
      disabled={update.isPending}
    />
  );
}

function FollowRow({ follow }: { follow: Follow }) {
  const toggle = useToggleFollow();
  // Straight off the payload (NEU-1396). The placeholder below is for a follow the catalog
  // can no longer resolve — a person TMDB deleted, a row written before a backfill — which
  // D-40 keeps rather than prunes, not for the ordinary case it used to cover.
  const label = follow.name ?? `${PLACEHOLDER[follow.entity_type]} ${follow.entity_id}`;
  const link = tmdbUrl(follow);
  const source = SOURCE_LABELS[follow.source];
  const image = profileUrl(follow.image_path, "w92");

  // The unfollow goes through the same mutation as every follow button in the app, so it takes
  // the same optimistic path and invalidates the same keys. `following: true` because a row on
  // this page is by definition one the user follows.
  const target: FollowTarget = {
    entityType: follow.entity_type,
    entityId: follow.entity_id,
    label,
    imagePath: follow.image_path,
  };

  return (
    <li className="flex items-center gap-3 py-2">
      {image ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          className="h-10 w-10 flex-none rounded object-cover"
        />
      ) : (
        <div aria-hidden="true" className="h-10 w-10 flex-none rounded bg-muted" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {follow.entity_type === "person" ? (
            // Linked whether or not we have a name: a row reading "Person 287" is exactly the
            // one whose reader most needs somewhere to go and find out who that is. The slug
            // is built from the label we have, or omitted — either resolves on the id.
            <Link to={personPath(follow.entity_id, follow.name ?? "")} className="hover:underline">
              {label}
            </Link>
          ) : (
            label
          )}
          {!follow.name && link && (
            <>
              {" "}
              <a
                href={link}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal underline underline-offset-4 text-muted-foreground hover:text-foreground"
              >
                look up on TMDB
              </a>
            </>
          )}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          Followed {formatEventDate(follow.created_at)}
          {source ? ` · ${source}` : ""}
        </p>
        {follow.entity_type === "person" && <FollowCoverageControl follow={follow} label={label} />}
      </div>
      <Button
        size="sm"
        variant="outline"
        aria-label={`Unfollow ${label}`}
        disabled={toggle.isPending}
        onClick={() => toggle.mutate({ target, following: true })}
      >
        Unfollow
      </Button>
    </li>
  );
}

/**
 * `/me/follows` — everything the user follows, grouped by kind, plus the box that adds more.
 *
 * Nothing on this page prunes on load (D-40): a follow whose entity has since left the catalog
 * still renders, because a grant that lapses and is restored must return the account exactly as
 * it was, and a list that quietly drops rows it cannot resolve is how that guarantee breaks.
 * Rows this browser has no name for say so and offer a TMDB link rather than disappearing.
 */
export function MyFollows() {
  const { data, isLoading, isError, error } = useFollows();
  const items = data?.items ?? [];

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Follows</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Your timeline and your alerts are built from these.
      </p>

      <div className="mt-6">
        <FollowEntitySearch />
      </div>

      {isLoading && <p className="mt-6 text-muted-foreground">Loading your follows…</p>}

      {isError && (
        <p className="mt-6 text-red-600">
          Failed to load your follows{error instanceof Error ? `: ${error.message}` : ""}.
        </p>
      )}

      {data && items.length === 0 && (
        <p className="mt-6 text-muted-foreground">
          You do not follow anything yet. Search above, or use the follow buttons on any film page.
        </p>
      )}

      {items.length > 0 &&
        GROUPS.map((group) => {
          const rows = items.filter((follow) => follow.entity_type === group.type);
          if (rows.length === 0) return null;
          return (
            <section key={group.type} className="mt-6">
              <h2 className="text-sm font-semibold text-foreground">
                {group.heading}{" "}
                <span className="font-normal text-muted-foreground">({rows.length})</span>
              </h2>
              {group.note && <p className="mt-0.5 text-xs text-muted-foreground">{group.note}</p>}
              <ul className="mt-1 divide-y divide-border">
                {rows.map((follow) => (
                  <FollowRow key={`${follow.entity_type}:${follow.entity_id}`} follow={follow} />
                ))}
              </ul>
            </section>
          );
        })}
    </div>
  );
}

export default MyFollows;
