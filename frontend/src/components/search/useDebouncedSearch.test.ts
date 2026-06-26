import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { filmsSearchHandler } from "@/test/msw/films-search";
import { useDebouncedSearch } from "./useDebouncedSearch";
import type { FilmIndexItem } from "@/api/types";

const BACKEND = "https://api.upmovies.localhost";

const sampleItem: FilmIndexItem = {
  slug: "the-odyssey-2026",
  title: "The Odyssey",
  release_year: 2026,
  poster_path: "/odyssey.jpg",
  arc_stage: "trailer",
};

describe("useDebouncedSearch", () => {
  it("returns idle/null immediately when query is below min length", () => {
    const { result } = renderHook(() => useDebouncedSearch("m", BACKEND));
    expect(result.current.results).toBeNull();
    expect(result.current.status).toBe("idle");
  });

  it("resets results and status when query drops below min length after a successful fetch", async () => {
    server.use(filmsSearchHandler({ items: [sampleItem] }));
    const { result, rerender } = renderHook(({ q }) => useDebouncedSearch(q, BACKEND), {
      initialProps: { q: "ma" },
    });
    // Wait for debounce + request to settle
    await waitFor(() => expect(result.current.results).not.toBeNull(), { timeout: 1000 });
    expect(result.current.status).toBe("success");

    // Drop below min length — internal state must reset immediately
    rerender({ q: "m" });
    await waitFor(() => {
      expect(result.current.results).toBeNull();
      expect(result.current.status).toBe("idle");
    });
  });
});
