import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoutesStub } from "react-router";
import { server } from "@/test/msw/server";
import { meHandler } from "@/test/msw/me";
import { followGraphHandlers } from "@/test/msw/follows";
import { AuthProvider } from "@/components/AuthContext";
import { FilmHeader } from "@/components/film/FilmHeader";
import type { FilmDetail, FilmEvent } from "@/api/types";

const film: FilmDetail = {
  ref: "the-odyssey-2026",
  title: "The Odyssey",
  release_date: "2026-07-17",
  release_year: 2026,
  poster_path: "/poster.jpg",
  arc_stage: "shooting",
  day_groups: [],
  overview: null,
  tagline: null,
  runtime: 148,
  genres: ["Adventure", "Drama"],
  production_countries: [],
  vote_average: null,
  vote_count: null,
  original_language: "en",
  backdrop_path: null,
  production_companies: ["Universal Pictures"],
  collection: null,
  release_dates: [
    {
      country: "US",
      release_type: 3,
      type_label: "Theatrical (limited)",
      date: "2026-07-17T00:00:00Z",
      certification: "PG-13",
    },
  ],
  alternative_titles: [],
  cast: [],
  crew: [
    { name: "Christopher Nolan", job: "Director", department: "Directing" },
    { name: "Christopher Nolan", job: "Screenplay", department: "Writing" },
    { name: "Jonathan Nolan", job: "Story", department: "Writing" },
  ],
  tmdb_id: 603,
  imdb_id: "tt0133093",
};

describe("FilmHeader", () => {
  it("renders the title, parenthetical year, poster, and arc", () => {
    render(<FilmHeader film={film} />);
    expect(screen.getByRole("heading", { name: "The Odyssey" })).toBeInTheDocument();
    expect(screen.getByText("(2026)")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /the odyssey poster/i })).toHaveAttribute(
      "src",
      "https://image.tmdb.org/t/p/w342/poster.jpg",
    );
    expect(screen.getByLabelText("Production status")).toBeInTheDocument();
  });

  it("renders labeled runtime and rating rows, without language", () => {
    render(<FilmHeader film={film} />);
    expect(screen.getByText("Runtime")).toBeInTheDocument();
    expect(screen.getByText("2h 28m")).toBeInTheDocument();
    expect(screen.getByText("Rating")).toBeInTheDocument();
    expect(screen.getByText("PG-13")).toBeInTheDocument();
    expect(screen.queryByText(/English/)).not.toBeInTheDocument();
  });

  it("omits the rating-body country for a US rating", () => {
    render(<FilmHeader film={film} />);
    expect(screen.queryByText("US")).not.toBeInTheDocument();
  });

  it("shows the rating-body country when the rating is not US", () => {
    const gbFilm: FilmDetail = {
      ...film,
      release_dates: [{ ...film.release_dates[0], country: "GB", certification: "15" }],
    };
    render(<FilmHeader film={gbFilm} />);
    expect(screen.getByText("15")).toBeInTheDocument();
    expect(screen.getByText("GB")).toBeInTheDocument();
  });

  it("renders Director / Screenplay / Story as separate labels from crew", () => {
    render(<FilmHeader film={film} />);
    expect(screen.getByText("Director")).toBeInTheDocument();
    expect(screen.getByText("Screenplay")).toBeInTheDocument();
    expect(screen.getByText("Story")).toBeInTheDocument();
    // Director name appears (Christopher Nolan is both Director and Screenplay → listed in each)
    expect(screen.getAllByText("Christopher Nolan").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Jonathan Nolan")).toBeInTheDocument();
  });

  it("omits a billing label with no people (no Writer credit here)", () => {
    render(<FilmHeader film={film} />);
    expect(screen.queryByText("Writer")).not.toBeInTheDocument();
  });

  it("renders each genre as its own capsule", () => {
    render(<FilmHeader film={film} />);
    expect(screen.getByText("Adventure")).toBeInTheDocument();
    expect(screen.getByText("Drama")).toBeInTheDocument();
    expect(screen.queryByText("Adventure, Drama")).not.toBeInTheDocument();
  });

  it("does not render production companies (they live below the cast)", () => {
    render(<FilmHeader film={film} />);
    expect(screen.queryByText("Universal Pictures")).not.toBeInTheDocument();
  });

  it("omits the poster when none is set", () => {
    render(<FilmHeader film={{ ...film, poster_path: null }} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("omits the parenthetical entirely when the film is undated", () => {
    // No arc-stage fallback here: the ArcStepper directly below already states production
    // status, so "(Announced)" beside the title is duplication (NEU-1215). Assert absence,
    // not an empty string — an empty "()" is the failure this guards against.
    render(<FilmHeader film={{ ...film, release_year: null, arc_stage: "announced" }} />);
    expect(screen.queryByText("(2026)")).toBeNull();
    expect(screen.queryByText("(Announced)")).toBeNull();
    expect(screen.queryByText("()")).toBeNull();
  });

  it("keeps the year and omits the arc-stage label for a dated film", () => {
    render(<FilmHeader film={film} />);
    expect(screen.getByText("(2026)")).toBeInTheDocument();
    expect(screen.queryByText("(Shooting)")).toBeNull();
  });

  it("lists production countries one per line, uncapped", () => {
    render(
      <FilmHeader film={{ ...film, production_countries: ["Ireland", "UK", "USA", "France"] }} />,
    );
    expect(screen.getByText("Countries")).toBeInTheDocument();
    for (const country of ["Ireland", "UK", "USA", "France"]) {
      expect(screen.getByText(country)).toBeInTheDocument();
    }
  });

  it("labels a single country in the singular", () => {
    render(<FilmHeader film={{ ...film, production_countries: ["USA"] }} />);
    expect(screen.getByText("Country")).toBeInTheDocument();
    expect(screen.queryByText("Countries")).toBeNull();
  });

  it("omits the countries row entirely when the film has none", () => {
    render(<FilmHeader film={film} />);
    expect(screen.queryByText("Country")).toBeNull();
    expect(screen.queryByText("Countries")).toBeNull();
  });

  it("still renders the Director billing row beside the countries", () => {
    // The film page reads its director out of `crew`, not a `directors` field — the whole
    // reason the h1 parenthetical stays year-only.
    render(<FilmHeader film={{ ...film, production_countries: ["USA"] }} />);
    expect(screen.getByText("Director")).toBeInTheDocument();
    expect(screen.getAllByText("Christopher Nolan").length).toBeGreaterThan(0);
  });

  it("renders the IMDb and TMDB links in the header", () => {
    render(<FilmHeader film={film} />);
    expect(screen.getByRole("link", { name: /imdb/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /tmdb/i })).toBeInTheDocument();
  });
});

describe("FilmHeader follow affordances", () => {
  const FILM_ID = "11111111-1111-4111-8111-111111111111";

  function renderHeader(overrides: Partial<FilmDetail> = {}) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Stub = createRoutesStub([
      { path: "/film/:ref", Component: () => <FilmHeader film={{ ...film, ...overrides }} /> },
    ]);
    return render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <Stub initialEntries={["/film/the-odyssey-2026"]} />
        </AuthProvider>
      </QueryClientProvider>,
    );
  }

  it("offers the watchlist toggle and the title follow once the film carries an id", async () => {
    server.use(meHandler({ entitled: true }), ...followGraphHandlers().handlers);
    renderHeader({ id: FILM_ID });

    expect(
      await screen.findByRole("button", { name: /add the odyssey to your watchlist/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^follow the odyssey$/i })).toBeInTheDocument();
  });

  it("offers neither while the payload carries no film id", () => {
    // Today's payload: the affordances are absent rather than inert, so the header reads
    // exactly as it did before.
    renderHeader();
    expect(screen.queryByRole("button", { name: /watchlist/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /watchlist/i })).not.toBeInTheDocument();
  });

  it("names the collection, with a follow button when it is identified", async () => {
    server.use(meHandler({ entitled: true }), ...followGraphHandlers().handlers);
    renderHeader({ collection: { name: "The Odyssey Collection", id: 726871 } });

    expect(screen.getByText("Collection")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /follow the odyssey collection/i }),
    ).toBeInTheDocument();
  });

  it("names a collection with no id without offering a follow", () => {
    renderHeader({ collection: { name: "The Odyssey Collection" } });
    expect(screen.getByText("The Odyssey Collection")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /follow/i })).not.toBeInTheDocument();
  });
});

describe("FilmHeader trailer button", () => {
  function trailer(overrides: Partial<FilmEvent> = {}): FilmEvent {
    return {
      event_id: "evt-trailer",
      event_type: "trailer",
      confidence: "confirmed",
      created_at: "2026-06-30T00:00:00Z",
      occurred_at: "2026-06-30T00:00:00Z",
      summary: "A trailer is out.",
      summary_edited: false,
      status: "published",
      superseded_by: null,
      provenance: "catalog",
      video_key: "abc123",
      sources: [],
      ...overrides,
    };
  }

  function withEvents(events: FilmEvent[]): FilmDetail {
    return {
      ...film,
      day_groups: [
        {
          day: "2026-06-30",
          heading: "Tuesday, June 30, 2026",
          news_events: [],
          tmdb_events: events,
        },
      ],
    };
  }

  // D-35 promotes the newest trailer out of the timeline; the player itself is the same
  // privacy-enhanced embed the cards use (NEU-1386).
  it("promotes the newest trailer on the page into a header button", async () => {
    render(<FilmHeader film={withEvents([trailer()])} />);
    await userEvent.click(screen.getByRole("button", { name: "Trailer" }));
    const frame = document.querySelector("iframe");
    expect(frame).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/abc123");
    expect(frame).toHaveAttribute("title", "The Odyssey trailer");
  });

  it("offers no button when the page holds no playable trailer", () => {
    render(<FilmHeader film={withEvents([trailer({ video_key: null })])} />);
    expect(screen.queryByRole("button", { name: "Trailer" })).toBeNull();
  });

  it("offers no button on a film with no events at all", () => {
    render(<FilmHeader film={film} />);
    expect(screen.queryByRole("button", { name: "Trailer" })).toBeNull();
  });
});
