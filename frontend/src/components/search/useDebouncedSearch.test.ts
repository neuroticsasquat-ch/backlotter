import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { filmsSearchHandler } from "@/test/msw/films-search";
import { useDebouncedSearch } from "./useDebouncedSearch";
import type { FilmIndexItem } from "@/api/types";

const BACKEND = "https://api.upmovies.localhost";

const sampleItem: FilmIndexItem = {
  ref: "the-odyssey-2026",
  title: "The Odyssey",
  release_year: 2026,
  poster_path: "/odyssey.jpg",
  arc_stage: "wrapped",
};

describe("useDebouncedSearch", () => {
  it("returns idle/null immediately when query is below min length", () => {
    const { result } = renderHook(() => useDebouncedSearch("m", BACKEND));
    expect(result.current.results).toBeNull();
    expect(result.current.status).toBe("idle");
  });

  it("never sends the SSR signing headers — search runs in the browser, per-visitor already", async () => {
    let captured: Headers | undefined;
    server.use(
      http.get(`${BACKEND}/films/search`, ({ request }) => {
        captured = request.headers;
        return HttpResponse.json({ items: [sampleItem], total: 1, limit: 8, offset: 0 });
      }),
    );
    const { result } = renderHook(() => useDebouncedSearch("ma", BACKEND));
    await waitFor(() => expect(result.current.results).not.toBeNull(), { timeout: 1000 });
    expect(captured?.get("X-Backlotter-Origin")).toBeNull();
    expect(captured?.get("X-Backlotter-Client-IP")).toBeNull();
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
