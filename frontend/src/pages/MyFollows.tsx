import { useId } from "react";
import { useFollows, useToggleFollow, useUpdateFollowCoverage } from "@/api/me";
import type { Follow, FollowCoverage, FollowEntityType } from "@/api/types";
import { FollowEntitySearch } from "@/components/follow/FollowEntitySearch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { FollowTarget } from "@/lib/film-entities";
import { formatEventDate } from "@/lib/format";
import { lookupFollowLabel } from "@/lib/follow-labels";
import { profileUrl } from "@/lib/poster";

/** The groups, in the order they appear. Fixed rather than derived from the data so the page
 *  does not reshuffle its headings as the user follows things. */
const GROUPS: { type: FollowEntityType; heading: string; note?: string }[] = [
  // The note answers the obvious misreading of the coverage radios below — that narrowing them
  // empties the timeline too. Once, on the group, rather than on every person row.
  {
    type: "person",
    heading: "People",
    note: "Your timeline shows every credit whichever you pick; this only narrows what we alert you about.",
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

/** The TMDB page for a followed entity, used as the fallback identification for a row whose
 *  name this browser never learned. `title` follows are film UUIDs, which TMDB cannot address,
 *  so they get no link. */
function tmdbUrl(follow: Follow): string | null {
  switch (follow.entity_type) {
    case "person":
      return `https://www.themoviedb.org/person/${follow.entity_id}`;
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

/** The two tiers a person follow can alert at (D-43), in the order they narrow. Companies,
 *  franchises and titles name one thing each and have nothing to narrow, so they draw no
 *  control — and the backend refuses a `coverage` on them outright. */
const COVERAGE: { value: FollowCoverage; label: string }[] = [
  { value: "lead", label: "Lead roles only" },
  { value: "all", label: "Every credit" },
];

/**
 * Which of a followed person's credits are worth an alert.
 *
 * Radios rather than a single "everything" switch, because neither tier is the absence of the
 * other: `lead` is a real editorial cut (director or top-3 billing), and a reader who picks it
 * is asking for fewer alerts, not for the control to be off. What it does *not* touch — the
 * timeline, which stays D-11 either way — is said once on the group heading, not on every row.
 */
function CoverageControl({ follow, label }: { follow: Follow; label: string }) {
  const groupId = useId();
  const update = useUpdateFollowCoverage();

  return (
    <fieldset className="mt-1" disabled={update.isPending}>
      <legend className="sr-only">{`Which of ${label}'s credits to alert me about`}</legend>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {COVERAGE.map((option) => {
          const id = `${groupId}-${option.value}`;
          return (
            <div key={option.value} className="flex items-center gap-1.5">
              <input
                id={id}
                type="radio"
                name={groupId}
                value={option.value}
                checked={follow.coverage === option.value}
                onChange={() => update.mutate({ follow, coverage: option.value })}
                className="h-3.5 w-3.5"
              />
              <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
                {option.label}
              </Label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function FollowRow({ follow }: { follow: Follow }) {
  const toggle = useToggleFollow();
  const known = lookupFollowLabel(follow.entity_type, follow.entity_id);
  const label = known?.label ?? `${PLACEHOLDER[follow.entity_type]} ${follow.entity_id}`;
  const link = tmdbUrl(follow);
  const source = SOURCE_LABELS[follow.source];
  const image = profileUrl(known?.imagePath ?? null, "w92");

  // The unfollow goes through the same mutation as every follow button in the app, so it takes
  // the same optimistic path and invalidates the same keys. `following: true` because a row on
  // this page is by definition one the user follows.
  const target: FollowTarget = {
    entityType: follow.entity_type,
    entityId: follow.entity_id,
    label,
    imagePath: known?.imagePath ?? null,
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
          {label}
          {!known && link && (
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
        {follow.entity_type === "person" && <CoverageControl follow={follow} label={label} />}
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
