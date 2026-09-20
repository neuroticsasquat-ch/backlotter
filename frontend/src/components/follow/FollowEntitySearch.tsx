import { useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { useFollows } from "@/api/me";
import {
  MIN_QUERY_LEN,
  useEntitySearch,
  type EntityResult,
  type SearchableEntityType,
} from "@/api/entities";
import { personPath, type FollowTarget } from "@/lib/film-entities";
import { rememberFollowLabel } from "@/lib/follow-labels";
import { profileUrl } from "@/lib/poster";
import { FollowButton } from "./FollowButton";

const TABS: { type: SearchableEntityType; label: string; placeholder: string }[] = [
  { type: "person", label: "People", placeholder: "Search people…" },
  { type: "company", label: "Companies", placeholder: "Search studios and companies…" },
  { type: "franchise", label: "Collections", placeholder: "Search collections…" },
];

/** Same 250ms as the admin user search — one request per pause in typing rather than one per
 *  keystroke, short enough that the list still feels like it is tracking the input. */
const DEBOUNCE_MS = 250;

const toTarget = (result: EntityResult): FollowTarget => ({
  entityType: result.entityType,
  entityId: result.entityId,
  label: result.label,
  imagePath: result.imagePath,
});

/**
 * The add-follow box on `/me/follows`: pick a kind, type a name, follow what comes back.
 *
 * Three separate searches rather than one blended list, because the backend has three
 * endpoints and no ranking that would put a studio and an actor in a defensible order against
 * each other (NEU-1350). The kind is a tab rather than a dropdown so the alternatives are
 * visible — a user who does not know collections are followable will not go looking in a
 * closed select.
 *
 * Each row's button is the same {@link FollowButton} the film page uses, so a result already
 * followed says "Following" on arrival and following one here remembers its name for the list
 * below (`lib/follow-labels.ts`).
 */
export function FollowEntitySearch() {
  const [entityType, setEntityType] = useState<SearchableEntityType>("person");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const inputId = useId();

  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  const { data, isFetching, isError, error } = useEntitySearch(entityType, query);
  const results = data?.items ?? [];
  const total = data?.total ?? 0;
  const active = TABS.find((tab) => tab.type === entityType) ?? TABS[0];
  const searched = query.length >= MIN_QUERY_LEN;

  // A result the user already follows is the one chance this browser gets to learn a name it
  // does not have: the follow itself happened on another device, or before this box existed,
  // and `GET /me/follows` will never tell us what "525" is called. Recording it here is what
  // stops the list below reading "Person 525" while this list says "Christopher Nolan" two
  // inches above it.
  //
  // Scoped to results the user *follows*, not every result rendered: a few searches return
  // dozens of names nobody has any interest in, and filling the registry with those would
  // evict the names of real follows (`lib/follow-labels.ts` caps it).
  const { data: follows } = useFollows();
  // Keyed off the two query payloads rather than off `results`, which `?? []` makes a new array
  // on every render — depending on that would re-run this on renders where nothing was fetched.
  const resultItems = data?.items;
  const followItems = follows?.items;
  useEffect(() => {
    if (!resultItems?.length || !followItems?.length) return;
    const followed = new Set(followItems.map((f) => `${f.entity_type}:${f.entity_id}`));
    for (const result of resultItems) {
      if (followed.has(`${result.entityType}:${result.entityId}`)) {
        rememberFollowLabel(result.entityType, result.entityId, result.label, result.imagePath);
      }
    }
  }, [resultItems, followItems]);

  return (
    <section
      aria-labelledby="add-follow-heading"
      className="rounded-lg border border-border bg-muted/30 p-4"
    >
      <h2 id="add-follow-heading" className="text-sm font-semibold text-foreground">
        Follow someone new
      </h2>

      <div role="tablist" aria-label="What to search" className="mt-3 flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.type}
            role="tab"
            type="button"
            aria-selected={tab.type === entityType}
            // The results list is what the tab controls, and it is the same node for all
            // three — the tab swaps what fills it rather than swapping panels.
            aria-controls="entity-search-results"
            onClick={() => setEntityType(tab.type)}
            className={
              tab.type === entityType
                ? "rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
                : "rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      <label htmlFor={inputId} className="sr-only">
        {active.placeholder}
      </label>
      <input
        id={inputId}
        type="search"
        value={input}
        placeholder={active.placeholder}
        // The backend caps `q` at 200; a longer one is a 422 rather than a search that finds
        // nothing, so the input stops before the request does.
        maxLength={200}
        onChange={(event) => setInput(event.target.value)}
        className="mt-3 w-full rounded border border-input bg-background px-3 py-2 text-sm"
      />

      <div id="entity-search-results" aria-busy={isFetching} className="mt-3">
        {!searched && (
          <p className="text-sm text-muted-foreground">
            Type at least {MIN_QUERY_LEN} characters to search.
          </p>
        )}

        {searched && isError && (
          <p className="text-sm text-red-600">
            Search failed{error instanceof Error ? `: ${error.message}` : ""}.
          </p>
        )}

        {searched && !isError && data && results.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No {active.label.toLowerCase()} match &quot;{query}&quot;.
          </p>
        )}

        {results.length > 0 && (
          <ul className="divide-y divide-border">
            {results.map((result) => (
              <li
                key={`${result.entityType}:${result.entityId}`}
                className="flex items-center gap-3 py-2"
              >
                <EntityThumb result={result} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {/* People have a page of ours to land on (NEU-1419); companies and
                        collections do not yet, so their names stay plain rather than linking
                        somewhere that would 404. */}
                    {result.entityType === "person" ? (
                      <Link
                        to={personPath(result.entityId, result.label)}
                        className="hover:underline"
                      >
                        {result.label}
                      </Link>
                    ) : (
                      result.label
                    )}
                  </p>
                  {result.secondary && (
                    <p className="truncate text-xs text-muted-foreground">{result.secondary}</p>
                  )}
                </div>
                <FollowButton target={toTarget(result)} />
              </li>
            ))}
          </ul>
        )}

        {total > results.length && (
          <p className="mt-2 text-xs text-muted-foreground">
            Showing the first {results.length} of {total}. Narrow the search to see the rest.
          </p>
        )}
      </div>
    </section>
  );
}

/** The result's face, logo or poster, or a neutral box where TMDB has no image. Decorative:
 *  the name is right beside it, so an alt text would only repeat it to a screen reader. */
function EntityThumb({ result }: { result: EntityResult }) {
  const src = profileUrl(result.imagePath, "w92");
  if (!src) {
    return <div aria-hidden="true" className="h-10 w-10 flex-none rounded bg-muted" />;
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className="h-10 w-10 flex-none rounded object-cover"
      // A company logo is a wide transparent PNG; cropping it to a square like a face would
      // cut the wordmark in half.
      style={result.entityType === "company" ? { objectFit: "contain" } : undefined}
    />
  );
}
