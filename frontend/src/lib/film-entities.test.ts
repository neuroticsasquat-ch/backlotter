import { describe, expect, it } from "vitest";
import type { FilmDetail } from "@/api/types";
import {
  collectionTarget,
  companyTarget,
  filmCompanies,
  franchisePath,
  personPath,
  personTarget,
  studioPath,
  titleTarget,
} from "./film-entities";

const FILM_ID = "11111111-1111-4111-8111-111111111111";

function makeFilm(overrides: Partial<FilmDetail> = {}): FilmDetail {
  return {
    ref: "603-the-odyssey",
    title: "The Odyssey",
    tmdb_id: 603,
    imdb_id: null,
    release_date: "2026-07-17",
    release_year: 2026,
    poster_path: "/poster.jpg",
    arc_stage: "shooting",
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
    ...overrides,
  };
}

describe("follow targets", () => {
  it("offers no target for an entity the payload does not identify", () => {
    // The public film DTO carries no ids yet, so this is today's every case: no id, no
    // link and no button, rather than a link to `/person/undefined`.
    expect(
      personTarget({ name: "Christopher Nolan", job: "Director", department: null }),
    ).toBeNull();
    expect(companyTarget({ name: "Universal Pictures" })).toBeNull();
    expect(collectionTarget({ name: "The Odyssey Collection" })).toBeNull();
  });

  it("offers no franchise target for a film in no collection", () => {
    expect(collectionTarget(null)).toBeNull();
  });

  it("stringifies the numeric TMDB ids the follow graph compares as strings", () => {
    expect(
      personTarget({ name: "Zendaya", character: null, profile_path: null, person_id: 505710 }),
    ).toEqual({ entityType: "person", entityId: "505710", label: "Zendaya" });
    expect(companyTarget({ name: "Legendary Pictures", id: 923 })).toEqual({
      entityType: "company",
      entityId: "923",
      label: "Legendary Pictures",
    });
    expect(collectionTarget({ name: "Dune Collection", id: 726871 })).toEqual({
      entityType: "franchise",
      entityId: "726871",
      label: "Dune Collection",
    });
  });
});

describe("filmCompanies", () => {
  it("prefers the id-bearing list when the payload carries one", () => {
    const film = makeFilm({
      production_companies: ["Universal Pictures"],
      companies: [{ id: 33, name: "Universal Pictures" }],
    });
    expect(filmCompanies(film)).toEqual([{ id: 33, name: "Universal Pictures" }]);
  });

  it("falls back to the bare names, which render without a studio link", () => {
    const film = makeFilm({ production_companies: ["Universal Pictures", "Legendary"] });
    expect(filmCompanies(film)).toEqual([{ name: "Universal Pictures" }, { name: "Legendary" }]);
  });
});

describe("titleTarget", () => {
  it("keys the film's own follow on its UUID, not its TMDB id", () => {
    // `entity_id` is what `GET /me/follows` echoes back for a title row, so a button keyed on
    // the TMDB id would never match its own follow and would read "Follow" forever.
    expect(titleTarget(makeFilm({ id: FILM_ID }))).toEqual({
      entityType: "title",
      entityId: FILM_ID,
      label: "The Odyssey",
    });
  });

  it("is null for a film with no id, like the follow targets beside it", () => {
    expect(titleTarget(makeFilm())).toBeNull();
  });
});

describe("personPath", () => {
  it("builds the ref from the id and a slug of the name", () => {
    expect(personPath(525, "Christopher Nolan")).toBe("/person/525-christopher-nolan");
  });

  it("folds diacritics rather than hyphenating at them", () => {
    expect(personPath(1, "Chloé Zhao")).toBe("/person/1-chloe-zhao");
  });

  it("runs punctuation and spacing together into single hyphens", () => {
    expect(personPath(2, "Joseph Gordon-Levitt, Jr.")).toBe("/person/2-joseph-gordon-levitt-jr");
  });

  it("falls back to the bare id for a name it cannot fold", () => {
    // A valid ref either way — the ref resolves on its leading id, and the page redirects to
    // the canonical form the backend mints.
    expect(personPath(3, "宮崎駿")).toBe("/person/3");
  });

  it("takes a string id, as the follow graph stores them", () => {
    expect(personPath("525", "Christopher Nolan")).toBe("/person/525-christopher-nolan");
  });
});

describe("studioPath and franchisePath", () => {
  // The three refs are one scheme, so these only have to differ in their segment — which is
  // the reader's word for the thing, not the payload's `company` / `collection` (EF-19).
  it("build the same ref under their own route segments", () => {
    expect(studioPath(33, "Universal Pictures")).toBe("/studio/33-universal-pictures");
    expect(franchisePath(726871, "Dune Collection")).toBe("/franchise/726871-dune-collection");
  });

  it("fold and run names together exactly as the person path does", () => {
    expect(studioPath(4, "20th Century Studios, Inc.")).toBe("/studio/4-20th-century-studios-inc");
    expect(franchisePath(5, "宮崎駿")).toBe("/franchise/5");
  });
});
