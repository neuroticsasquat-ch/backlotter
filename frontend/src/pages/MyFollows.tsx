import { useId, useMemo, useState } from "react";
import { Link } from "react-router";
import { useFollows, useToggleFollow } from "@/api/me";
import type { Follow, FollowEntityType } from "@/api/types";
import { FollowEntitySearch } from "@/components/follow/FollowEntitySearch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { franchisePath, personPath, studioPath, type FollowTarget } from "@/lib/film-entities";
import { formatEventDate, formatHeadlineRelease, formatRelativeDate } from "@/lib/format";
import { profileUrl } from "@/lib/poster";

/** The four chips, in a fixed order — the on-screen vocabulary of EF-19 over the payload's
 *  words, which the code keeps: a `company` is a Studio and a `franchise` is a Franchise.
 *  Films first because a title follow is the one most readers have most of. */
const TYPES: { type: FollowEntityType; chip: string; pill: string }[] = [
  { type: "title", chip: "Films", pill: "Film" },
  { type: "person", chip: "People", pill: "Person" },
  { type: "company", chip: "Studios", pill: "Studio" },
  { type: "franchise", chip: "Franchises", pill: "Franchise" },
];

const PILL = new Map(TYPES.map(({ type, pill }) => [type, pill]));

type SortKey = "activity" | "created" | "name";

const SORTS: { value: SortKey; label: string }[] = [
  // `created` first because it is the default, and a select whose default is not its first
  // option reads as a value somebody already changed.
  { value: "created", label: "Newest followed" },
  { value: "activity", label: "Last activity" },
  { value: "name", label: "Name A–Z" },
];

/** Where a follow came from, shown only when it is not the user's own click — "manual" is the
 *  default and saying so on every row would be noise. */
const SOURCE_LABELS: Record<string, string> = {
  letterboxd_import: "from Letterboxd import",
  tmdb_import: "from TMDB import",
  derived: "added automatically",
};

/** Which chips are lit, remembered across visits. A per-viewer convenience and nothing more —
 *  a reader who filtered to People last week should not have to do it again — so every access
 *  is wrapped: storage throws outright in a private window with site data blocked, and an
 *  unreadable preference must cost the page a filter, not a render. */
const CHIPS_KEY = "backlotter:follows-types";

function readChips(): FollowEntityType[] {
  try {
    const raw = localStorage.getItem(CHIPS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Filtered against the known four rather than trusted: the value survives deploys, and a
    // type this build has never heard of would otherwise hide every row forever with no
    // visible chip to turn back off.
    return TYPES.map((t) => t.type).filter((type) => parsed.includes(type));
  } catch {
    return [];
  }
}

function writeChips(types: FollowEntityType[]): void {
  try {
    localStorage.setItem(CHIPS_KEY, JSON.stringify(types));
  } catch {
    // Nothing to do and nothing to tell the user: the filter still works for this visit.
  }
}

/** The followed entity's own page. Every row that can have one links inward (EF-15) — people
 *  since NEU-1419, studios and franchises since they got pages in NEU-1429 — and nothing on
 *  this page links out to TMDB any more.
 *
 *  Linked whether or not we have a name, on the precedent NEU-1419 set for people: the ref
 *  resolves on its leading id and the slug half is decorative, so the link is well formed with
 *  only a placeholder to slug from. It is not always *live* — a null name means the catalog
 *  holds no row for that id, and the entity page reads the same table, so an unnamed row links
 *  to a 404. That is the honest answer for a follow D-40 keeps after its entity left the
 *  catalog, and a better one than silently rendering the id as dead text.
 *
 *  `title` is the one type with no link. Its `entity_id` is our film UUID, and a film page is
 *  addressed by `<tmdb_id>-<slug>` — `GET /me/follows` carries neither, so a film row cannot
 *  mint one. It stays unlinked until the payload gains a `ref`. */
function entityPagePath(follow: Follow): string | null {
  const name = follow.name ?? "";
  switch (follow.entity_type) {
    case "person":
      return personPath(follow.entity_id, name);
    case "company":
      return studioPath(follow.entity_id, name);
    case "franchise":
      return franchisePath(follow.entity_id, name);
    default:
      return null;
  }
}

/** What the row calls itself. Straight off the payload (NEU-1396); the placeholder is for a
 *  follow the catalog can no longer resolve — a person TMDB deleted, a row written before a
 *  backfill — which D-40 keeps rather than prunes. */
const rowLabel = (follow: Follow): string =>
  follow.name ?? `${PILL.get(follow.entity_type) ?? "Follow"} ${follow.entity_id}`;

/** Newest first, with a stable tiebreak so two follows made in the same second do not swap
 *  places between renders. */
const byCreatedDesc = (a: Follow, b: Follow) =>
  b.created_at.localeCompare(a.created_at) ||
  `${a.entity_type}:${a.entity_id}`.localeCompare(`${b.entity_type}:${b.entity_id}`);

/**
 * The three sorts (EF-15). Each is total: **nulls last** in both the sorts that have them, and
 * "newest followed" beneath that as the tiebreak, so the order never depends on what `GET
 * /me/follows` happened to return first.
 *
 * Nulls sort last rather than first because in both cases null is an absence the reader is not
 * looking for — an unresolvable name, and a follow that has delivered nothing yet, which is a
 * real and common state rather than a missing value (EF-15).
 */
const COMPARATORS: Record<SortKey, (a: Follow, b: Follow) => number> = {
  created: byCreatedDesc,
  name: (a, b) => {
    if (a.name === null || b.name === null) {
      if (a.name !== b.name) return a.name === null ? 1 : -1;
      return byCreatedDesc(a, b);
    }
    return a.name.localeCompare(b.name) || byCreatedDesc(a, b);
  },
  activity: (a, b) => {
    const left = a.last_activity_at;
    const right = b.last_activity_at;
    if (left === null || right === null) {
      if (left !== right) return left === null ? 1 : -1;
      return byCreatedDesc(a, b);
    }
    return right.localeCompare(left) || byCreatedDesc(a, b);
  },
};

function TypeChips({
  selected,
  onToggle,
}: {
  selected: FollowEntityType[];
  onToggle: (type: FollowEntityType) => void;
}) {
  return (
    // Toggle buttons rather than checkboxes: each one acts on the list immediately, and none of
    // them is part of anything to submit. `aria-pressed` is what carries the on/off state.
    <div role="group" aria-label="Filter by type" className="flex flex-wrap gap-2">
      {TYPES.map(({ type, chip }) => {
        const on = selected.includes(type);
        return (
          <Button
            key={type}
            type="button"
            size="sm"
            variant={on ? "secondary" : "outline"}
            aria-pressed={on}
            onClick={() => onToggle(type)}
          >
            {chip}
          </Button>
        );
      })}
    </div>
  );
}

function FollowRow({ follow }: { follow: Follow }) {
  const toggle = useToggleFollow();
  const label = rowLabel(follow);
  const href = entityPagePath(follow);
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

  const meta = [`Followed ${formatEventDate(follow.created_at)}`];
  const source = SOURCE_LABELS[follow.source];
  if (source) meta.push(source);
  // Only when there is one: "Last activity never" would read as a fault, and a follow that has
  // delivered nothing yet is the ordinary state of one taken out this morning.
  if (follow.last_activity_at)
    meta.push(`Last activity ${formatRelativeDate(follow.last_activity_at)}`);

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
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className="truncate">
            {href ? (
              <Link to={href} className="hover:underline">
                {label}
              </Link>
            ) : (
              label
            )}
          </span>
          <span className="flex-none rounded-full border border-border px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
            {PILL.get(follow.entity_type)}
          </span>
        </p>
        {/* Films only: it is the one type with a date of its own (EF-15), and the backend
            sends null on the other three rather than inventing one. */}
        {follow.entity_type === "title" && (
          <p className="truncate text-xs text-muted-foreground">
            {formatHeadlineRelease(follow.headline_release)}
          </p>
        )}
        <p className="truncate text-xs text-muted-foreground">{meta.join(" · ")}</p>
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
 * `/me/follows` — one flat list of everything the user follows, plus the box that adds more.
 *
 * One list rather than a heading per type (EF-15, replacing NEU-1415's grouped page): the
 * reader's question is "what do I follow", and four headings answered it by making them read
 * four lists to find one row. The chips narrow it when they *do* want one type, the sorts
 * answer "what have I added lately" and "what has been quiet", and the text filter finds a
 * single row without any of that. All three are client-side because the list arrives whole.
 *
 * Nothing here prunes on load (D-40): a follow whose entity has since left the catalog still
 * renders, because a grant that lapses and is restored must return the account exactly as it
 * was, and a list that quietly drops rows it cannot resolve is how that guarantee breaks. A row
 * the catalog cannot name falls back to its type and id, and still links to its page.
 */
export function MyFollows() {
  const { data, isLoading, isError, error } = useFollows();
  const [types, setTypes] = useState<FollowEntityType[]>(readChips);
  const [sort, setSort] = useState<SortKey>("created");
  const [query, setQuery] = useState("");
  const sortId = useId();
  const filterId = useId();

  const items = useMemo(() => data?.items ?? [], [data]);

  const visible = useMemo(() => {
    // No chip lit means every type, not none: the empty selection is the page's resting state,
    // and reading it as "show nothing" would greet most readers with an empty list.
    const byType = types.length === 0 ? items : items.filter((f) => types.includes(f.entity_type));
    const needle = query.trim().toLowerCase();
    // Matched against the label the row actually shows, which is the name whenever there is
    // one: a reader typing what is on screen should find it, including the "Person 287" a row
    // falls back to when the catalog cannot name it.
    const byName = needle
      ? byType.filter((f) => rowLabel(f).toLowerCase().includes(needle))
      : byType;
    return [...byName].sort(COMPARATORS[sort]);
  }, [items, types, query, sort]);

  const toggleType = (type: FollowEntityType) => {
    setTypes((current) => {
      const next = current.includes(type) ? current.filter((t) => t !== type) : [...current, type];
      writeChips(next);
      return next;
    });
  };

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Follows</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Your timeline and your digest are built from these.
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

      {items.length > 0 && (
        <>
          <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
            <TypeChips selected={types} onToggle={toggleType} />
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <Label htmlFor={filterId} className="text-xs text-muted-foreground">
                  Find
                </Label>
                <Input
                  id={filterId}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter by name"
                  className="mt-1 h-9 w-48"
                />
              </div>
              <div>
                <Label htmlFor={sortId} className="text-xs text-muted-foreground">
                  Sort by
                </Label>
                <select
                  id={sortId}
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  className="mt-1 h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {SORTS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="mt-6 text-muted-foreground">
              Nothing here matches. Try another type or clear the filter.
            </p>
          ) : (
            // Named so it can be told apart from the add box's own results list, which sits
            // above it on the same page and is also a list of followable entities.
            <ul aria-label="Your follows" className="mt-2 divide-y divide-border">
              {visible.map((follow) => (
                <FollowRow key={`${follow.entity_type}:${follow.entity_id}`} follow={follow} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export default MyFollows;
