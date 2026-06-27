import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router";
import { Input } from "@/components/ui/input";
import { env } from "@/env";
import { useDebouncedSearch } from "./useDebouncedSearch";
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
  const [inputValue, setInputValue] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const { results, status } = useDebouncedSearch(inputValue, env.apiBaseUrl);

  // Close the dropdown on any navigation (picking a result, "see all", Enter).
  // The header persists across route changes, so without this the open listbox
  // would linger over the destination page.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing dropdown state to router navigation
    setDismissed(true);
    setActiveIndex(-1);
  }, [location.key]);

  // Options list for keyboard nav: just the film results (no dedicated results page).
  const options = results ?? [];

  const showDropdown =
    mounted && (results !== null || status === "loading") && !dismissed && status !== "error";

  const activeDescendant = mounted && activeIndex >= 0 ? `search-opt-${activeIndex}` : undefined;

  // Screen-reader announcement for the result count / no-results state. Driven off
  // the live results so the persistent status region (below) mutates in place —
  // a region that only mounts together with its text doesn't reliably announce.
  const announcement =
    showDropdown && results !== null
      ? results.length === 0
        ? "No films found."
        : `${results.length} result${results.length === 1 ? "" : "s"} found.`
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
        // No results page: Enter goes to the highlighted result, or the top match.
        if (!results || results.length === 0) break;
        e.preventDefault();
        const idx = activeIndex >= 0 && activeIndex < results.length ? activeIndex : 0;
        void navigate(`/film/${results[idx].slug}`);
        break;
      }
    }
  }

  return (
    <div role="search" aria-label="Film search" className="relative w-full" onBlur={handleBlur}>
      <label htmlFor="search-q" className="sr-only">
        Search films
      </label>
      <Input
        id="search-q"
        type="search"
        name="q"
        placeholder="Search films…"
        value={inputValue}
        onChange={handleInputChange}
        className="w-full"
        role={mounted ? "combobox" : undefined}
        aria-expanded={mounted ? showDropdown : undefined}
        aria-controls={mounted ? "search-listbox" : undefined}
        aria-activedescendant={activeDescendant}
        onKeyDown={mounted ? handleKeyDown : undefined}
      />
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
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-96 overflow-auto rounded-md border border-border bg-background py-1 shadow-lg"
        >
          {results?.map((item, i) => (
            <SearchResultItem
              key={item.slug}
              item={item}
              id={`search-opt-${i}`}
              isActive={activeIndex === i}
            />
          ))}
          {results?.length === 0 && (
            // Not a selectable option — a visible status message for sighted users;
            // screen readers are served by the aria-live region above.
            <li role="presentation" className="px-3 py-2 text-sm text-muted-foreground">
              No films match &quot;{inputValue}&quot;
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
