import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import {
  getCalendar,
  getCollectionsSearch,
  getCompaniesSearch,
  getFeedGrouped,
  getFilm,
  getFilmSearch,
  getPeopleSearch,
  getPerson,
  getPopularPeople,
} from "@/api/public";
import type { CalendarResponse, FeedDayResponse, FilmDetail, FilmIndexResponse } from "@/api/types";

const BACKEND = "https://api.upmovies.localhost";

const sample: FilmDetail = {
  ref: "the-odyssey-2026",
  title: "The Odyssey",
  release_date: "2026-07-17",
  release_year: 2026,
  poster_path: "/poster.jpg",
  arc_stage: "wrapped",
  day_groups: [],
  overview: null,
  tagline: null,
  runtime: null,
  genres: [],
  production_countries: [],
  vote_average: null,
  vote_count: null,
  original_language: null,
  backdrop_path: null,
  production_companies: [],
  collection: null,
  release_dates: [],
  alternative_titles: [],
  cast: [],
  crew: [],
  tmdb_id: 12345,
  imdb_id: null,
};

describe("getFilm", () => {
  it("returns the typed film on 200", async () => {
    server.use(http.get(`${BACKEND}/films/the-odyssey-2026`, () => HttpResponse.json(sample)));
    const film = await getFilm(BACKEND, "the-odyssey-2026");
    expect(film?.ref).toBe("the-odyssey-2026");
    expect(film?.arc_stage).toBe("wrapped");
  });

  it("returns null on 404", async () => {
    server.use(http.get(`${BACKEND}/films/missing`, () => new HttpResponse(null, { status: 404 })));
    expect(await getFilm(BACKEND, "missing")).toBeNull();
  });

  it("throws on a 500", async () => {
    server.use(http.get(`${BACKEND}/films/boom`, () => new HttpResponse(null, { status: 500 })));
    await expect(getFilm(BACKEND, "boom")).rejects.toThrow(/failed: 500/);
  });
});

const sampleGrouped: FeedDayResponse = {
  items: [
    {
      film_ref: "the-odyssey-2026",
      film_title: "The Odyssey",
      release_year: 2026,
      poster_path: "/poster.jpg",
      arc_stage: "shooting",
      production_countries: [],
      directors: [],
      day: "2026-06-23",
      top_event_type: "casting",
      event_types: ["casting"],
      event_count: 2,
      news_backed: true,
      events: [],
    },
  ],
  total: 1,
  limit: 50,
  offset: 0,
};

describe("getFeedGrouped", () => {
  it("returns the typed grouped feed on 200 and sends default limit/offset", async () => {
    let captured: URL | undefined;
    server.use(
      http.get(`${BACKEND}/feed/grouped`, ({ request }) => {
        captured = new URL(request.url);
        return HttpResponse.json(sampleGrouped);
      }),
    );
    const feed = await getFeedGrouped(BACKEND);
    expect(feed.total).toBe(1);
    expect(feed.items[0].film_ref).toBe("the-odyssey-2026");
    expect(feed.items[0].event_count).toBe(2);
    expect(captured?.searchParams.get("limit")).toBe("50");
    expect(captured?.searchParams.get("offset")).toBe("0");
  });

  it("throws on a 500", async () => {
    server.use(http.get(`${BACKEND}/feed/grouped`, () => new HttpResponse(null, { status: 500 })));
    await expect(getFeedGrouped(BACKEND)).rejects.toThrow(/failed: 500/);
  });
});

const sampleCalendar: CalendarResponse = {
  items: [
    {
      film_ref: "the-odyssey-2026",
      film_title: "The Odyssey",
      release_year: 2026,
      poster_path: "/poster.jpg",
      release_date: "2026-07-17",
      release_type: "wide",
      director: null,
      stars: [],
      genres: [],
    },
  ],
  total: 1,
  limit: 100,
  offset: 0,
};

describe("getCalendar", () => {
  it("returns the typed response on 200 and sends default limit=100 and offset=0", async () => {
    let captured: URL | undefined;
    server.use(
      http.get(`${BACKEND}/calendar`, ({ request }) => {
        captured = new URL(request.url);
        return HttpResponse.json(sampleCalendar);
      }),
    );
    const calendar = await getCalendar(BACKEND);
    expect(calendar.total).toBe(1);
    expect(calendar.items[0].film_ref).toBe("the-odyssey-2026");
    expect(calendar.items[0].release_type).toBe("wide");
    expect(captured?.searchParams.get("limit")).toBe("100");
    expect(captured?.searchParams.get("offset")).toBe("0");
  });

  it("sends explicit limit and offset when provided", async () => {
    let captured: URL | undefined;
    server.use(
      http.get(`${BACKEND}/calendar`, ({ request }) => {
        captured = new URL(request.url);
        return HttpResponse.json({ ...sampleCalendar, limit: 50, offset: 10 });
      }),
    );
    const calendar = await getCalendar(BACKEND, { limit: 50, offset: 10 });
    expect(calendar.limit).toBe(50);
    expect(calendar.offset).toBe(10);
    expect(captured?.searchParams.get("limit")).toBe("50");
    expect(captured?.searchParams.get("offset")).toBe("10");
  });

  it("throws on a 500", async () => {
    server.use(http.get(`${BACKEND}/calendar`, () => new HttpResponse(null, { status: 500 })));
    await expect(getCalendar(BACKEND)).rejects.toThrow(/failed: 5\d\d/);
  });
});

const sampleSearch: FilmIndexResponse = {
  items: [
    {
      ref: "the-matrix-1999",
      title: "The Matrix",
      release_year: 1999,
      poster_path: "/matrix.jpg",
      arc_stage: "released",
    },
  ],
  total: 1,
  limit: 8,
  offset: 0,
};

describe("getFilmSearch", () => {
  it("returns typed FilmIndexResponse on 200", async () => {
    server.use(http.get(`${BACKEND}/films/search`, () => HttpResponse.json(sampleSearch)));
    const result = await getFilmSearch(BACKEND, "matrix");
    expect(result.total).toBe(1);
    expect(result.items[0].ref).toBe("the-matrix-1999");
    expect(result.items[0].arc_stage).toBe("released");
  });

  it("sends q, limit, and offset as query params", async () => {
    let captured: URLSearchParams | undefined;
    server.use(
      http.get(`${BACKEND}/films/search`, ({ request }) => {
        captured = new URL(request.url).searchParams;
        return HttpResponse.json(sampleSearch);
      }),
    );
    await getFilmSearch(BACKEND, "matrix", { limit: 8, offset: 0 });
    expect(captured?.get("q")).toBe("matrix");
    expect(captured?.get("limit")).toBe("8");
    expect(captured?.get("offset")).toBe("0");
  });

  it("throws on non-OK response", async () => {
    server.use(http.get(`${BACKEND}/films/search`, () => new HttpResponse(null, { status: 500 })));
    await expect(getFilmSearch(BACKEND, "matrix")).rejects.toThrow(/failed: 500/);
  });

  it("respects a provided AbortSignal", async () => {
    server.use(http.get(`${BACKEND}/films/search`, () => HttpResponse.json(sampleSearch)));
    const controller = new AbortController();
    controller.abort();
    await expect(getFilmSearch(BACKEND, "matrix", { signal: controller.signal })).rejects.toThrow();
  });
});

describe("SSR signing headers", () => {
  const signed = { "X-Backlotter-Origin": "s3cret", "X-Backlotter-Client-IP": "203.0.113.7" };

  function captureHeaders(path: string, body: FilmDetail | FeedDayResponse | CalendarResponse) {
    let captured: Headers | undefined;
    server.use(
      http.get(`${BACKEND}${path}`, ({ request }) => {
        captured = request.headers;
        return HttpResponse.json(body);
      }),
    );
    return () => captured;
  }

  it("forwards them on getFilm", async () => {
    const headers = captureHeaders("/films/the-odyssey-2026", sample);
    await getFilm(BACKEND, "the-odyssey-2026", { headers: signed });
    expect(headers()?.get("X-Backlotter-Origin")).toBe("s3cret");
    expect(headers()?.get("X-Backlotter-Client-IP")).toBe("203.0.113.7");
    expect(headers()?.get("Accept")).toBe("application/json");
  });

  it("forwards them on getFeedGrouped", async () => {
    const headers = captureHeaders("/feed/grouped", sampleGrouped);
    await getFeedGrouped(BACKEND, { headers: signed });
    expect(headers()?.get("X-Backlotter-Origin")).toBe("s3cret");
    expect(headers()?.get("X-Backlotter-Client-IP")).toBe("203.0.113.7");
  });

  it("forwards them on getCalendar", async () => {
    const headers = captureHeaders("/calendar", sampleCalendar);
    await getCalendar(BACKEND, { headers: signed });
    expect(headers()?.get("X-Backlotter-Origin")).toBe("s3cret");
    expect(headers()?.get("X-Backlotter-Client-IP")).toBe("203.0.113.7");
  });

  it("sends neither header when the caller omits them (the browser-side path)", async () => {
    const headers = captureHeaders("/feed/grouped", sampleGrouped);
    await getFeedGrouped(BACKEND);
    expect(headers()?.get("X-Backlotter-Origin")).toBeNull();
    expect(headers()?.get("X-Backlotter-Client-IP")).toBeNull();
  });
});

/**
 * The dev stack's base URL is **relative** (`VITE_API_BASE_URL=/api`), so the browser reaches
 * the API same-origin through Vite's proxy. Every test above passes an absolute one, which is
 * exactly how `new URL(path, "/api")` — a `TypeError` thrown before any request goes out —
 * killed search, both "View more" buttons, the add-follow box and the onboarding grid in dev
 * without a single failing test (NEU-1421).
 *
 * jsdom gives these an origin to resolve against, as a browser does. A caller must not have to
 * know which spelling it was handed.
 */
describe("a relative base URL, as the dev proxy hands it to the browser", () => {
  // The page's own origin, whatever jsdom gives this run — the point is that the fetcher
  // resolves against it, not that it is any particular host.
  const ORIGIN = globalThis.location.origin;
  const proxied = (path: string) => `${ORIGIN}/api${path}`;

  it("resolves against the page origin and keeps the proxy prefix", async () => {
    let seen: string | undefined;
    server.use(
      http.get(proxied("/films/search"), ({ request }) => {
        seen = request.url;
        return HttpResponse.json({ items: [], total: 0, limit: 8, offset: 0 });
      }),
    );

    await getFilmSearch("/api", "odyssey", { limit: 8 });

    // The prefix survives: `new URL("/films/search", "http://host/api")` would have dropped it,
    // because an absolute path replaces the base's path.
    expect(new URL(seen ?? "").pathname).toBe("/api/films/search");
    expect(new URL(seen ?? "").searchParams.get("q")).toBe("odyssey");
  });

  it.each([
    ["the feed", () => getFeedGrouped("/api"), "/api/feed/grouped"],
    ["the calendar", () => getCalendar("/api"), "/api/calendar"],
    ["people search", () => getPeopleSearch("/api", "nolan"), "/api/people/search"],
    ["company search", () => getCompaniesSearch("/api", "a24"), "/api/companies/search"],
    ["collection search", () => getCollectionsSearch("/api", "star"), "/api/collections/search"],
    ["the onboarding grid", () => getPopularPeople("/api"), "/api/people/popular"],
  ])("reaches %s", async (_label, call, pathname) => {
    let seen: string | undefined;
    server.use(
      http.get(`${ORIGIN}${pathname}`, ({ request }) => {
        seen = request.url;
        return HttpResponse.json({ items: [], total: 0, limit: 10, offset: 0, days: [] });
      }),
    );

    await call();

    expect(new URL(seen ?? "").pathname).toBe(pathname);
  });

  it("reaches a film and a person by ref", async () => {
    server.use(
      http.get(proxied("/films/603-the-odyssey"), () => HttpResponse.json(sample)),
      http.get(proxied("/people/525-christopher-nolan"), () =>
        HttpResponse.json({ ref: "525-christopher-nolan", id: 525, name: "Christopher Nolan" }),
      ),
    );

    expect(await getFilm("/api", "603-the-odyssey")).toMatchObject({ title: "The Odyssey" });
    expect(await getPerson("/api", "525-christopher-nolan")).toMatchObject({ id: 525 });
  });

  it("does not double the slash when the base carries a trailing one", async () => {
    let seen: string | undefined;
    server.use(
      http.get(proxied("/calendar"), ({ request }) => {
        seen = request.url;
        return HttpResponse.json({ days: [], total: 0, limit: 100, offset: 0 });
      }),
    );

    await getCalendar("/api/");

    expect(new URL(seen ?? "").pathname).toBe("/api/calendar");
  });

  it("treats a bare slash as the page origin itself", async () => {
    let seen: string | undefined;
    server.use(
      http.get(`${ORIGIN}/calendar`, ({ request }) => {
        seen = request.url;
        return HttpResponse.json({ days: [], total: 0, limit: 100, offset: 0 });
      }),
    );

    await getCalendar("/");

    expect(new URL(seen ?? "").pathname).toBe("/calendar");
  });

  it("still takes an absolute base, which is what SSR and prod pass", async () => {
    server.use(http.get(`${BACKEND}/films/603`, () => HttpResponse.json(sample)));
    expect(await getFilm(BACKEND, "603")).toMatchObject({ title: "The Odyssey" });
  });

  it("keeps a path component on an absolute base, which `new URL` would have dropped", async () => {
    // The trap the helper exists to avoid, asserted rather than left in a comment:
    // `new URL("/calendar", "https://host/api")` resolves to `https://host/calendar`, because
    // an absolute path replaces the base's path. Nothing deployed mounts the API under a path
    // today, so this guards the reasoning rather than a live config.
    let seen: string | undefined;
    server.use(
      http.get("https://gateway.example/api/calendar", ({ request }) => {
        seen = request.url;
        return HttpResponse.json({ days: [], total: 0, limit: 100, offset: 0 });
      }),
    );

    await getCalendar("https://gateway.example/api");

    expect(new URL(seen ?? "").pathname).toBe("/api/calendar");
  });
});
