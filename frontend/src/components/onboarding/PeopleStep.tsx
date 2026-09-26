import { useEffect, useId, useState } from "react";
import { MIN_QUERY_LEN, useEntitySearch, usePopularPeople } from "@/api/entities";
import { useFollows } from "@/api/me";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { PersonTile } from "./PersonTile";

/** Same 250ms as the follows page's add box — one request per pause in typing. */
const DEBOUNCE_MS = 250;

/**
 * Step 2 of `/welcome`: the faces that make a timeline out of an empty account (D-17).
 *
 * One grid, fed from either the popular list or a search, rather than a grid with a dropdown
 * over it: the user is doing the same thing in both cases — picking people — and swapping what
 * fills the grid keeps their picks in view while they look for the next one. Clearing the box
 * puts the popular faces back, so a search is never a dead end.
 *
 * People only, unlike `/me/follows` — a user three minutes into their first session is being
 * asked for the handful of names they would say out loud, and studios and collections are a
 * refinement they can find later on the follows page.
 */
export function PeopleStep({ onContinue, onSkip }: { onContinue: () => void; onSkip: () => void }) {
  const inputId = useId();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  const searching = query.length >= MIN_QUERY_LEN;
  const popular = usePopularPeople();
  const search = useEntitySearch("person", query);
  // The follows list is what every tile reads to know whether it is pressed. Subscribing here
  // as well means the grid waits for it rather than rendering thirty dimmed faces whose picked
  // ones light up with a badge a moment later.
  const follows = useFollows();

  const people = searching ? (search.data?.items ?? []) : (popular.data ?? []);
  const isLoading = (searching ? search.isLoading : popular.isLoading) || follows.isLoading;
  const error = searching ? search.error : popular.error;
  const followedCount = follows.data?.items.filter((f) => f.entity_type === "person").length ?? 0;

  return (
    <section aria-labelledby="people-step-heading">
      <h2 id="people-step-heading" className="text-xl font-semibold text-foreground">
        Follow a few people
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Your timeline is built from who you follow. Pick some directors and actors whose next film
        you would want to hear about — you can always change this later.
      </p>

      <label htmlFor={inputId} className="sr-only">
        Search for a person
      </label>
      <div className="relative mt-4">
        <input
          id={inputId}
          type="search"
          value={input}
          placeholder="Search for someone…"
          // The backend caps `q` at 200 and answers 422 above it, so the input stops first.
          maxLength={200}
          onChange={(event) => setInput(event.target.value)}
          className="w-full rounded border border-input bg-background py-2 pl-3 pr-9 text-sm"
        />
        {search.isFetching && <Spinner className="absolute right-3 top-1/2 -translate-y-1/2" />}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {searching ? `Results for “${query}”` : "Popular on backlotter right now"}
      </p>

      <div aria-busy={searching ? search.isFetching : popular.isFetching} className="mt-2">
        {isLoading && <p className="text-sm text-muted-foreground">Loading people…</p>}

        {error && (
          <p className="text-sm text-red-600">
            We could not load these{error instanceof Error ? `: ${error.message}` : ""}.
          </p>
        )}

        {/* Not while a search is in flight: the held previous answer is not this query's. */}
        {!isLoading && !error && !search.isFetching && people.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {searching ? `Nobody matches “${query}”.` : "No people to show yet."}
          </p>
        )}

        {people.length > 0 && (
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {people.map((person) => (
              <li key={person.entityId}>
                <PersonTile person={person} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 flex items-center gap-4">
        <Button type="button" onClick={onContinue}>
          Continue
        </Button>
        <button
          type="button"
          onClick={onSkip}
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Skip this step
        </button>
        {followedCount > 0 && (
          <span className="text-sm text-muted-foreground">
            Following {followedCount} {followedCount === 1 ? "person" : "people"}
          </span>
        )}
      </div>
    </section>
  );
}
