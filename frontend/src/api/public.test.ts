import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { getCalendar, getFeedGrouped, getFilm, getFilmSearch } from "@/api/public";
import type { CalendarResponse, FeedDayResponse, FilmDetail, FilmIndexResponse } from "@/api/types";

const BACKEND = "https://api.upmovies.localhost";

const sample: FilmDetail = {
  slug: "the-odyssey-2026",
  title: "The Odyssey",
  release_date: "2026-07-17",
  release_year: 2026,
  poster_path: "/poster.jpg",
  arc_stage: "trailer",
  events: [],
  overview: null,
  tagline: null,
  runtime: null,
  genres: [],
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
    expect(film?.slug).toBe("the-odyssey-2026");
    expect(film?.arc_stage).toBe("trailer");
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
      film_slug: "the-odyssey-2026",
      film_title: "The Odyssey",
      release_year: 2026,
      poster_path: "/poster.jpg",
      day: "2026-06-23",
      top_event_type: "casting",
      event_count: 2,
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
    expect(feed.items[0].film_slug).toBe("the-odyssey-2026");
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
      film_slug: "the-odyssey-2026",
      film_title: "The Odyssey",
      release_year: 2026,
      poster_path: "/poster.jpg",
      release_date: "2026-07-17",
      release_type: "wide",
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
    expect(calendar.items[0].film_slug).toBe("the-odyssey-2026");
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
      slug: "the-matrix-1999",
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
    expect(result.items[0].slug).toBe("the-matrix-1999");
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
