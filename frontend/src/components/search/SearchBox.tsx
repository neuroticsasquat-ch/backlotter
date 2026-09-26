import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { env } from "@/env";
import { useDebouncedSearch, type SearchHit } from "./useDebouncedSearch";
import { SearchResultItem } from "./SearchResultItem";

// SSR-safe hydration flag: returns false during server render, true on the client,
// without triggering the react-hooks/set-state-in-effect lint rule.
const emptySubscribe = () => () => {};
function useMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

export function SearchBox() {
  const mounted = useMounted();
  const headingId = useId();
  const [inputValue, setInputValue] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const { groups, status } = useDebouncedSearch(inputValue, env.apiBaseUrl);

  // Close the dropdown on any navigation (picking a result, "see all", Enter).
  // The header persists across route changes, so without this the open listbox
  // would linger over the destination page.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing dropdown state to router navigation
    setDismissed(true);
    setActiveIndex(-1);
  }, [location.key]);

  // Keyboard navigation runs over every hit in every group, in the order they render, so
  // ArrowDown walks from the last film into the first person without a second key.
  const options: SearchHit[] = groups?.flatMap((group) => group.items) ?? [];

  // The index each group's first hit occupies in `options`, so a row can name its own option
  // id without the render having to carry a running counter.
  let optionOffset = 0;
  const groupOffsets = (groups ?? []).map((group) => {
    const offset = optionOffset;
    optionOffset += group.items.length;
    return offset;
  });

  // Opens on an answer, never on `loading` alone: before the first answer there is nothing to
  // show, and an open empty box reads as a broken one. A re-query keeps the held groups open
  // under the input's spinner until the new answer replaces them (NEU-1469 D-1469.6).
  const showDropdown = mounted && groups !== null && !dismissed && status !== "error";

  const activeDescendant = mounted && activeIndex >= 0 ? `search-opt-${activeIndex}` : undefined;

  // Screen-reader announcement for the searching / result count / no-results state. Driven
  // off the live results so the persistent status region (below) mutates in place — a region
  // that only mounts together with its text doesn't reliably announce. A re-query over held
  // groups keeps the count it already announced: "Searching…" on every debounce over a list
  // that is still on screen would be noise.
  const announcement =
    status === "loading" && groups === null
      ? "Searching…"
      : showDropdown && groups !== null
        ? options.length === 0
          ? "No results found."
          : `${options.length} result${options.length === 1 ? "" : "s"} found.`
        : "";

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputValue(e.target.value);
    // Reset dropdown state whenever the user changes the query
    setDismissed(false);
    setActiveIndex(-1);
  }

  // Clear the query and close the dropdown — the reset shared by Escape and click-away.
  function resetSearch() {
    setInputValue("");
    setDismissed(true);
    setActiveIndex(-1);
  }

  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    // Focus moving to an option link stays within currentTarget, so selecting a
    // result doesn't trip this — navigation closes the dropdown instead. Clicking
    // anywhere else clears the query and closes the box, like pressing Escape.
    if (!e.currentTarget.contains(e.relatedTarget)) {
      resetSearch();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, options.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case "Escape":
        // Defocus and reset the input (the blur handler also runs resetSearch).
        resetSearch();
        e.currentTarget.blur();
        break;
      case "Enter": {
        // No results page: Enter goes to the highlighted result, or the top match — which,
        // with no cross-type ranking, is the first hit of the first group that found anything.
        if (options.length === 0) break;
        e.preventDefault();
        const idx = activeIndex >= 0 && activeIndex < options.length ? activeIndex : 0;
        void navigate(options[idx].to);
        break;
      }
    }
  }

  return (
    <div role="search" aria-label="Search" className="relative w-full" onBlur={handleBlur}>
      <label htmlFor="search-q" className="sr-only">
        Search films, people, studios and franchises
      </label>
      <Input
        id="search-q"
        type="search"
        name="q"
        placeholder="Search films, people, studios…"
        value={inputValue}
        onChange={handleInputChange}
        className="w-full pr-9"
        role={mounted ? "combobox" : undefined}
        aria-expanded={mounted ? showDropdown : undefined}
        aria-controls={mounted ? "search-listbox" : undefined}
        aria-activedescendant={activeDescendant}
        onKeyDown={mounted ? handleKeyDown : undefined}
      />
      {status === "loading" && (
        // Beside the input rather than in the dropdown, so it shows whether the dropdown is
        // closed (a first query) or holding the previous query's hits (a re-query).
        <Spinner className="absolute right-3 top-1/2 -translate-y-1/2" />
      )}
      {/* Persistent (post-hydration) live region so result-count / no-results
          announcements fire when its text changes, not when it first mounts. */}
      {mounted && (
        <div role="status" aria-live="polite" className="sr-only">
          {announcement}
        </div>
      )}
      {showDropdown && (
        <ul
          id="search-listbox"
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[70vh] overflow-auto rounded-md border border-border bg-background py-1 shadow-lg"
        >
          {/* One `group` per type rather than four listboxes: a screen reader reads the heading
              as the group's name on entering it, and arrow keys still traverse the whole set.
              A group that was asked and found nothing is absent from `groups` entirely — an
              empty type is silent rather than a row saying so four times over. A group whose
              request failed is kept, and says so below. */}
          {groups?.map((group, g) => (
            <li key={group.key} role="group" aria-labelledby={`${headingId}-${group.key}`}>
              <div
                id={`${headingId}-${group.key}`}
                className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {group.label}
              </div>
              <ul role="presentation">
                {group.items.map((item, i) => (
                  <SearchResultItem
                    key={item.key}
                    item={item}
                    id={`search-opt-${groupOffsets[g] + i}`}
                    isActive={activeIndex === groupOffsets[g] + i}
                  />
                ))}
                {group.failed && (
                  // A group we could not ask says so. Silence here would read as "no film
                  // matches your query", which is a different and false claim.
                  <li role="presentation" className="px-3 py-2 text-sm text-muted-foreground">
                    Couldn&apos;t search {group.label.toLowerCase()} just now
                  </li>
                )}
              </ul>
            </li>
          ))}
          {groups?.length === 0 && (
            // Not a selectable option — a visible status message for sighted users;
            // screen readers are served by the aria-live region above.
            <li role="presentation" className="px-3 py-2 text-sm text-muted-foreground">
              Nothing matches &quot;{inputValue}&quot;
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
