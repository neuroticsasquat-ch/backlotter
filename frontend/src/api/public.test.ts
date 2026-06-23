import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { getFilm } from "@/api/public";
import type { FilmDetail } from "@/api/types";

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
