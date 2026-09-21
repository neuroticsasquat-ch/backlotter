import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { headerSearchHandlers } from "@/test/msw/search";
import { useDebouncedSearch } from "./useDebouncedSearch";
import type { CompanySearchItem, FilmIndexItem, PersonSearchItem } from "@/api/types";

const BACKEND = "https://api.upmovies.localhost";

const film: FilmIndexItem = {
  ref: "the-odyssey-2026",
  title: "The Odyssey",
  release_year: 2026,
  poster_path: "/odyssey.jpg",
  arc_stage: "wrapped",
};

const person: PersonSearchItem = {
  id: 525,
  name: "Christopher Nolan",
  known_for_department: "Directing",
  profile_path: "/nolan.jpg",
};

const company: CompanySearchItem = {
  id: 41,
  name: "A24",
  logo_path: "/a24.png",
  origin_country: "US",
};

describe("useDebouncedSearch", () => {
  it("returns idle/null immediately when query is below min length", () => {
    const { result } = renderHook(() => useDebouncedSearch("m", BACKEND));
    expect(result.current.groups).toBeNull();
    expect(result.current.status).toBe("idle");
  });

  it("never sends the SSR signing headers — search runs in the browser, per-visitor already", async () => {
    let captured: Headers | undefined;
    // The capturing handler first: `server.use` matches in the order it is handed them, so
    // the defaults behind it only serve the three endpoints it does not claim.
    server.use(
      http.get(`${BACKEND}/films/search`, ({ request }) => {
        captured = request.headers;
        return HttpResponse.json({ items: [film], total: 1, limit: 5, offset: 0 });
      }),
      ...headerSearchHandlers(),
    );
    const { result } = renderHook(() => useDebouncedSearch("ma", BACKEND));
    await waitFor(() => expect(result.current.groups).not.toBeNull(), { timeout: 1000 });
    expect(captured?.get("X-Backlotter-Origin")).toBeNull();
    expect(captured?.get("X-Backlotter-Client-IP")).toBeNull();
  });

  it("returns one group per type that found something, in spec order", async () => {
    server.use(...headerSearchHandlers({ films: [film], people: [person], companies: [company] }));
    const { result } = renderHook(() => useDebouncedSearch("ma", BACKEND));
    await waitFor(() => expect(result.current.groups).not.toBeNull(), { timeout: 1000 });

    // Collections answered with nothing, so no Franchises group exists at all.
    expect(result.current.groups?.map((g) => g.key)).toEqual(["film", "person", "company"]);
    expect(result.current.groups?.every((g) => !g.failed)).toBe(true);
    expect(result.current.groups?.map((g) => g.label)).toEqual(["Films", "People", "Studios"]);
  });

  it("builds each hit's own page URL", async () => {
    server.use(...headerSearchHandlers({ films: [film], people: [person], companies: [company] }));
    const { result } = renderHook(() => useDebouncedSearch("ma", BACKEND));
    await waitFor(() => expect(result.current.groups).not.toBeNull(), { timeout: 1000 });

    expect(result.current.groups?.flatMap((g) => g.items).map((i) => i.to)).toEqual([
      "/film/the-odyssey-2026",
      "/person/525-christopher-nolan",
      "/studio/41-a24",
    ]);
  });

  it("labels an undated film with its arc stage where a dated one shows the year", async () => {
    server.use(
      ...headerSearchHandlers({
        films: [{ ...film, release_year: null, arc_stage: "announced" }],
      }),
    );
    const { result } = renderHook(() => useDebouncedSearch("ma", BACKEND));
    await waitFor(() => expect(result.current.groups).not.toBeNull(), { timeout: 1000 });

    expect(result.current.groups?.[0].items[0].detail).toBe("Announced");
  });

  it("caps each group at five hits however many the endpoint sends", async () => {
    const people = Array.from({ length: 9 }, (_, i) => ({ ...person, id: i + 1 }));
    server.use(...headerSearchHandlers({ people }));
    const { result } = renderHook(() => useDebouncedSearch("ma", BACKEND));
    await waitFor(() => expect(result.current.groups).not.toBeNull(), { timeout: 1000 });

    expect(result.current.groups?.[0].items).toHaveLength(5);
  });

  it("renders the groups that answered when one endpoint fails", async () => {
    server.use(
      http.get(`${BACKEND}/people/search`, () => new HttpResponse(null, { status: 500 })),
      ...headerSearchHandlers({ films: [film] }),
    );
    const { result } = renderHook(() => useDebouncedSearch("ma", BACKEND));
    await waitFor(() => expect(result.current.groups).not.toBeNull(), { timeout: 1000 });

    expect(result.current.status).toBe("success");
    // The failed group survives, flagged, so the dropdown can say it could not be asked
    // instead of dropping it like a group that genuinely found nothing.
    expect(result.current.groups?.map((g) => g.key)).toEqual(["film", "person"]);
    expect(result.current.groups?.map((g) => g.failed)).toEqual([false, true]);
    expect(result.current.groups?.[1].items).toEqual([]);
  });

  it("errors only when every endpoint fails", async () => {
    server.use(...headerSearchHandlers({ status: 500 }));
    const { result } = renderHook(() => useDebouncedSearch("ma", BACKEND));
    await waitFor(() => expect(result.current.status).toBe("error"), { timeout: 1000 });
    expect(result.current.groups).toBeNull();
  });

  it("resets results and status when query drops below min length after a successful fetch", async () => {
    server.use(...headerSearchHandlers({ films: [film] }));
    const { result, rerender } = renderHook(({ q }) => useDebouncedSearch(q, BACKEND), {
      initialProps: { q: "ma" },
    });
    // Wait for debounce + request to settle
    await waitFor(() => expect(result.current.groups).not.toBeNull(), { timeout: 1000 });
    expect(result.current.status).toBe("success");

    // Drop below min length — internal state must reset immediately
    rerender({ q: "m" });
    await waitFor(() => {
      expect(result.current.groups).toBeNull();
      expect(result.current.status).toBe("idle");
    });
  });
});
