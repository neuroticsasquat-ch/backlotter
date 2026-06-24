import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { getFeedGrouped, getFilm } from "@/api/public";
import type { FeedDayResponse, FilmDetail } from "@/api/types";

const BACKEND = "https://api.upmovies.localhost";

const sample: FilmDetail = {
  slug: "the-odyssey-2026",
  title: "The Odyssey",
  release_date: "2026-07-17",
  release_year: 2026,
  poster_path: "/poster.jpg",
  arc_stage: "trailer",
  events: [],
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
