import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoutesStub } from "react-router";
import { server } from "@/test/msw/server";
import { meHandler, unauthMeHandler } from "@/test/msw/me";
import { followGraphHandlers } from "@/test/msw/follows";
import { AuthProvider } from "@/components/AuthContext";
import { FilmHeader } from "@/components/film/FilmHeader";
import { FOLLOW_CUE, LOCKED_COPY } from "@/components/follow/access";
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

  it("links the billing rows to their person pages (EF-16)", () => {
    // The most prominent person names on the page, and the ones that stayed plain text when
    // NEU-1419 linked the cast and crew *lists*. With the row buttons gone the link is the
    // only way to reach a director from here, so an unlinked one is a person the reader
    // cannot follow at all.
    const Stub = createRoutesStub([
      {
        path: "/film/:ref",
        Component: () => (
          <FilmHeader
            film={{
              ...film,
              crew: [
                {
                  name: "Christopher Nolan",
                  job: "Director",
                  department: "Directing",
                  person_id: 525,
                },
                { name: "Jonathan Nolan", job: "Story", department: "Writing", person_id: 527 },
              ],
            }}
          />
        ),
      },
    ]);
    render(<Stub initialEntries={["/film/the-odyssey-2026"]} />);

    expect(screen.getByRole("link", { name: "Christopher Nolan" })).toHaveAttribute(
      "href",
      "/person/525-christopher-nolan",
    );
    // A Story credit is linked too. It never carried a follow button, on D-11's seed grade,
    // which is exactly the gap the link closes.
    expect(screen.getByRole("link", { name: "Jonathan Nolan" })).toHaveAttribute(
      "href",
      "/person/527-jonathan-nolan",
    );
  });

  it("leaves a billing name the payload cannot identify as plain text", () => {
    // The default fixture's crew carries no `person_id` — today's every case for the public
    // film DTO — and a link here would point at `/person/undefined`.
    render(<FilmHeader film={film} />);
    expect(screen.queryByRole("link", { name: "Christopher Nolan" })).not.toBeInTheDocument();
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

  it("offers exactly one follow button on the whole header (EF-16)", async () => {
    // The count is the assertion. The header used to carry the film's button *and* the
    // franchise's, and the cast, crew and company rows carried more below it; a reader
    // deciding whether to follow a film had four kinds of button to tell apart. One here,
    // and the entity pages hold the rest.
    server.use(meHandler({ entitled: true }), ...followGraphHandlers().handlers);
    renderHeader({ id: FILM_ID, collection: { name: "The Odyssey Collection", id: 726871 } });

    expect(
      await screen.findByRole("button", { name: /^follow the odyssey$/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /follow/i })).toHaveLength(1);
  });

  it("follows the film by its UUID, not its TMDB id", async () => {
    // A title follow keyed on anything else would never match its own row in
    // `["me","follows"]`, so the button would read "Follow" forever.
    const graph = followGraphHandlers();
    server.use(meHandler({ entitled: true }), ...graph.handlers);
    renderHeader({ id: FILM_ID });

    await userEvent.click(await screen.findByRole("button", { name: /^follow the odyssey$/i }));

    await waitFor(() =>
      expect(graph.follows).toEqual([
        expect.objectContaining({ entity_type: "title", entity_id: FILM_ID }),
      ]),
    );
  });

  it("says what following a film does, as text rather than a tooltip", async () => {
    server.use(meHandler({ entitled: true }), ...followGraphHandlers().handlers);
    renderHeader({ id: FILM_ID });

    await screen.findByRole("button", { name: /^follow the odyssey$/i });
    expect(screen.getByText(FOLLOW_CUE)).toBeInTheDocument();
  });

  it("reads the cue to an anonymous visitor too — they are who needs it", async () => {
    server.use(unauthMeHandler());
    renderHeader({ id: FILM_ID });

    expect(
      await screen.findByRole("link", { name: /sign in to follow the odyssey/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(FOLLOW_CUE)).toBeInTheDocument();
  });

  it("keeps the locked tooltip and the cue apart in the locked state", async () => {
    // The two pieces of copy share this row and must not fight: the locked explanation stays
    // a native `title` on the disabled button's wrapper, the cue stays ordinary text below.
    server.use(meHandler({ entitled: false }));
    renderHeader({ id: FILM_ID });

    const button = await screen.findByRole("button", { name: /^follow the odyssey$/i });
    expect(button).toBeDisabled();
    expect(button.parentElement).toHaveAttribute("title", LOCKED_COPY);
    expect(screen.getByText(FOLLOW_CUE)).toBeInTheDocument();
  });

  it("offers neither control nor cue while the payload carries no film id", () => {
    // A cue explaining a button that is not there would be worse than silence.
    renderHeader();
    expect(screen.queryByRole("button", { name: /follow the odyssey/i })).not.toBeInTheDocument();
    expect(screen.queryByText(FOLLOW_CUE)).not.toBeInTheDocument();
  });

  it("names the collection and links it, without a button beside it", async () => {
    server.use(meHandler({ entitled: true }), ...followGraphHandlers().handlers);
    renderHeader({ id: FILM_ID, collection: { name: "The Odyssey Collection", id: 726871 } });

    expect(screen.getByText("Collection")).toBeInTheDocument();
    // Waited out through the film's own button, so this is the settled header rather than the
    // pre-auth paint that has no buttons in it either.
    await screen.findByRole("button", { name: /^follow the odyssey$/i });
    expect(
      screen.queryByRole("button", { name: /follow the odyssey collection/i }),
    ).not.toBeInTheDocument();
  });

  it("links an identified collection to its franchise page", () => {
    renderHeader({ collection: { name: "The Odyssey Collection", id: 726871 } });
    expect(screen.getByRole("link", { name: "The Odyssey Collection" })).toHaveAttribute(
      "href",
      "/franchise/726871-the-odyssey-collection",
    );
  });

  it("names a collection with no id without linking it", () => {
    renderHeader({ collection: { name: "The Odyssey Collection" } });
    expect(screen.getByText("The Odyssey Collection")).toBeInTheDocument();
    // A link here would point at `/franchise/undefined`.
    expect(screen.queryByRole("link", { name: "The Odyssey Collection" })).not.toBeInTheDocument();
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
