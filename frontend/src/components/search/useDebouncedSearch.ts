import { useState, useEffect } from "react";
import { getFilmSearch } from "@/api/public";
import type { FilmIndexItem } from "@/api/types";

const MIN_QUERY_LEN = 2;
const DEBOUNCE_MS = 300;
const DROPDOWN_LIMIT = 8;

type SearchStatus = "idle" | "loading" | "success" | "error";

export function useDebouncedSearch(q: string, baseUrl: string) {
  const [results, setResults] = useState<FilmIndexItem[] | null>(null);
  const [status, setStatus] = useState<SearchStatus>("idle");

  useEffect(() => {
    if (q.length < MIN_QUERY_LEN) {
      // Reset internal state so stale results don't flash when the query comes
      // back above the minimum length before the debounce fires.
      setResults(null); // eslint-disable-line react-hooks/set-state-in-effect
      setStatus("idle");
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setStatus("loading");
      try {
        const res = await getFilmSearch(baseUrl, q, {
          limit: DROPDOWN_LIMIT,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setResults(res.items);
          setStatus("success");
        }
      } catch {
        if (!controller.signal.aborted) {
          setResults(null);
          setStatus("error");
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, baseUrl]);

  return { results, status };
}
