import { createRoutesStub } from "react-router";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { dayItem } from "@/test/feed-fixtures";
import type { FeedDayItem, FeedVia, FilmEvent } from "@/api/types";
import { TimelineDayGroups } from "@/components/feed/TimelineDayGroups";

/** Renders the timeline's day body on its own, inside a router for its links. The page around
 *  it — empty state, lapsed panel, paging — is `TimelinePage`'s and is covered through the home
 *  route in `routes/feed.test.tsx`. */
function renderDays(items: FeedDayItem[]) {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <TimelineDayGroups items={items} /> },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

function evt(
  event_id: string,
  event_type: string,
  summary: string,
  overrides: Partial<FilmEvent> = {},
): FilmEvent {
  return {
    event_id,
    event_type,
    confidence: "confirmed",
    created_at: "2026-06-23T10:00:00Z",
    occurred_at: "2026-06-23T10:00:00Z",
    summary,
    summary_edited: false,
    status: "published",
    superseded_by: null,
    video_key: null,
    provenance: "catalog",
    sources: [],
    ...overrides,
  };
}

/** One timeline row: a film, reached by `via` (omitted for a title row), carrying `events`. */
function row(
  film_ref: string,
  film_title: string,
  via: FeedVia | null | undefined,
  events: FilmEvent[],
  overrides: Partial<FeedDayItem> = {},
): FeedDayItem {
  const event_types = [...new Set(events.map((e) => e.event_type))];
  return dayItem(film_ref, {
    film_title,
    events,
    event_types,
    top_event_type: event_types[0],
    event_count: events.length,
    ...(via === undefined ? {} : { via }),
    ...overrides,
  });
}

const villeneuve: FeedVia = {
  entity_type: "person",
  entity_id: "137427",
  name: "Denis Villeneuve",
  ref: "137427-denis-villeneuve",
};
const legendary: FeedVia = {
  entity_type: "company",
  entity_id: "923",
  name: "Legendary Pictures",
  ref: "923-legendary-pictures",
};
const duneSaga: FeedVia = {
  entity_type: "franchise",
  entity_id: "726871",
  name: "Dune Collection",
  ref: "726871-dune-collection",
};

const cancel = evt("dune-cancel", "canceled", "The film has been canceled.");

/** The block headings (h3) in render order. */
function blockHeadings() {
  return screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
}

/** The block an h3 heads: its heading's parent. */
function block(label: string) {
  return screen.getByRole("heading", { level: 3, name: label }).parentElement!;
}

describe("timeline day by follow block", () => {
  it("renders all four blocks in order, with the heading ladder h2 → h3 → h4 → h5", () => {
    renderDays([
      row("heat-2", "Heat 2", null, [evt("heat-date", "release_date", "Date slipped.")]),
      row("dune-3", "Dune Part Three", villeneuve, [
        evt("dune-casting", "casting", "Villeneuve attached as director."),
      ]),
      row("dune-3", "Dune Part Three", legendary, [
        evt("dune-co", "company_attached", "Legendary Pictures joins as a production company."),
      ]),
      row("dune-3", "Dune Part Three", duneSaga, [
        evt("dune-coll", "collection_attached", "Dune Part Three joins the Dune Collection."),
      ]),
    ]);

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/June 23, 2026/);
    expect(blockHeadings()).toEqual(["Films", "People", "Studios", "Franchises"]);
    expect(within(block("People")).getByRole("heading", { level: 4 })).toHaveTextContent(
      "Not yet reported (unconfirmed)",
    );
    expect(within(block("People")).getByRole("heading", { level: 5 })).toHaveTextContent(
      "Attached",
    );
    // The Films block's update types are the feed's, a level down.
    expect(within(block("Films")).getByRole("heading", { level: 5 })).toHaveTextContent(
      "Release date",
    );
  });

  it("shows the Films heading on a day of title rows only", () => {
    renderDays([row("heat-2", "Heat 2", null, [evt("heat-date", "release_date", "Slipped.")])]);
    expect(blockHeadings()).toEqual(["Films"]);
  });

  it("renders rows without a `via` field as title rows, the day reading as it always has", () => {
    renderDays([
      row("heat-2", "Heat 2", undefined, [evt("heat-date", "release_date", "Slipped.")]),
      row("odyssey", "The Odyssey", undefined, [evt("ody-trailer", "trailer", "First trailer.")], {
        news_backed: true,
      }),
    ]);

    expect(blockHeadings()).toEqual(["Films"]);
    const films = block("Films");
    expect(within(films).getByText("Heat 2").closest("a")).toHaveAttribute("href", "/film/heat-2");
    expect(within(films).getByText("The Odyssey").closest("a")).toHaveAttribute(
      "href",
      "/film/odyssey",
    );
    expect(within(films).getByRole("heading", { level: 4, name: "In the news" })).toBeTruthy();
  });

  it("keeps a film reached only through an entity out of the Films block", () => {
    renderDays([
      row("heat-2", "Heat 2", null, [evt("heat-date", "release_date", "Slipped.")]),
      row("rama", "Rendezvous with Rama", villeneuve, [
        evt("rama-crew", "crew_attached", "Villeneuve will direct."),
      ]),
    ]);

    expect(within(block("Films")).queryByText("Rendezvous with Rama")).toBeNull();
    expect(within(block("People")).getByText("Rendezvous with Rama")).toBeInTheDocument();
  });

  it("shows a card reached two ways under both blocks", () => {
    renderDays([
      row("dune-3", "Dune Part Three", null, [cancel]),
      row("dune-3", "Dune Part Three", villeneuve, [cancel]),
    ]);

    expect(within(block("Films")).getByText(/The film has been canceled\./)).toBeInTheDocument();
    expect(within(block("People")).getByText(/The film has been canceled\./)).toBeInTheDocument();
  });

  it("de-duplicates the poster strip over a film present in two blocks", () => {
    renderDays([
      row("dune-3", "Dune Part Three", null, [cancel], { poster_path: "/dune.jpg" }),
      row("dune-3", "Dune Part Three", villeneuve, [cancel], { poster_path: "/dune.jpg" }),
      row("rama", "Rendezvous with Rama", villeneuve, [evt("rama-crew", "crew_attached", "X.")], {
        poster_path: "/rama.jpg",
      }),
    ]);

    expect(screen.getAllByRole("img", { name: "Dune Part Three poster" })).toHaveLength(1);
    // An entity-only film still has its poster in the strip (FB-7).
    expect(screen.getByRole("img", { name: "Rendezvous with Rama poster" })).toBeInTheDocument();
  });
});

describe("entity rows", () => {
  it.each([
    [villeneuve, "People", "/person/137427-denis-villeneuve"],
    [legendary, "Studios", "/studio/923-legendary-pictures"],
    [duneSaga, "Franchises", "/franchise/726871-dune-collection"],
  ])("headlines the row with the entity, linked to its page", (via, label, href) => {
    renderDays([row("dune-3", "Dune Part Three", via, [cancel])]);

    expect(within(block(label)).getByRole("link", { name: via.name! })).toHaveAttribute(
      "href",
      href,
    );
  });

  it("renders an entity the catalog cannot name as its type fallback, unlinked", () => {
    renderDays([
      row("dune-3", "Dune Part Three", { ...villeneuve, name: null, ref: null }, [cancel]),
    ]);

    const fallback = within(block("People")).getByText("A person you follow");
    expect(fallback.closest("a")).toBeNull();
    // The row still renders its line.
    expect(within(block("People")).getByText(/The film has been canceled\./)).toBeInTheDocument();
  });

  it("leads each line with its film, linked, then the summary", () => {
    renderDays([
      row(
        "rama",
        "Rendezvous with Rama",
        villeneuve,
        [evt("rama-crew", "crew_attached", "Villeneuve will direct.")],
        { news_backed: true },
      ),
    ]);

    const film = within(block("People")).getByText("Rendezvous with Rama").closest("a");
    expect(film).toHaveAttribute("href", "/film/rama");
    expect(film?.closest("p")).toHaveTextContent(/Rendezvous with Rama.*Villeneuve will direct\./);
  });

  it("merges one entity's cards across films into one row, a line per card", () => {
    renderDays([
      row("rama", "Rendezvous with Rama", villeneuve, [
        evt("rama-crew", "crew_attached", "Villeneuve will direct."),
      ]),
      row("dune-3", "Dune Part Three", villeneuve, [
        evt("dune-crew", "crew_attached", "Villeneuve returns to direct."),
      ]),
    ]);

    const people = block("People");
    expect(within(people).getAllByRole("link", { name: "Denis Villeneuve" })).toHaveLength(1);
    // Lines by film natural title.
    const films = within(people)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"))
      .filter((href) => href?.startsWith("/film/"));
    expect(films).toEqual(["/film/dune-3", "/film/rama"]);
  });

  it("keeps the beat and confidence pills under In the news", () => {
    renderDays([
      row(
        "rama",
        "Rendezvous with Rama",
        villeneuve,
        [evt("rama-crew", "crew_attached", "Villeneuve will direct.", { provenance: "story" })],
        { news_backed: true },
      ),
    ]);

    const people = block("People");
    expect(within(people).getByText("Crew attached")).toBeInTheDocument();
    expect(within(people).getByText("confirmed")).toBeInTheDocument();
  });

  it("lays Not yet reported out as Attached, Detached, Canceled, dropping the pills", () => {
    renderDays([
      row("dune-3", "Dune Part Three", villeneuve, [
        cancel,
        evt("dune-left", "crew_removed", "Villeneuve leaves the film."),
        evt("dune-joined", "casting", "Villeneuve joins the cast as himself."),
      ]),
    ]);

    const people = block("People");
    expect(
      within(people)
        .getAllByRole("heading", { level: 5 })
        .map((h) => h.textContent),
    ).toEqual(["Attached", "Detached", "Canceled"]);
    for (const pill of ["Casting", "Crew departure", "confirmed", "unconfirmed"]) {
      expect(within(people).queryByText(pill)).toBeNull();
    }
    // Each heading holds only its own type's line.
    const detached = within(people).getByRole("heading", {
      level: 5,
      name: "Detached",
    }).parentElement!;
    expect(within(detached).getByText(/Villeneuve leaves the film\./)).toBeInTheDocument();
    expect(within(detached).queryByText(/The film has been canceled\./)).toBeNull();
  });

  it("keeps the beat pill under Other updates", () => {
    renderDays([
      row("dune-3", "Dune Part Three", villeneuve, [
        evt("dune-trailer", "trailer", "A new trailer is out."),
      ]),
    ]);

    const other = within(block("People")).getByRole("heading", {
      level: 5,
      name: "Other updates",
    }).parentElement!;
    expect(within(other).getByText("New trailer")).toBeInTheDocument();
  });

  it("never credits JustWatch under an entity block", () => {
    renderDays([
      row("dune-3", "Dune Part Three", villeneuve, [
        evt("dune-avail", "now_available", "Now streaming on Max."),
      ]),
    ]);

    expect(within(block("People")).getByText(/Now streaming on Max\./)).toBeInTheDocument();
    expect(screen.queryByText(/justwatch/i)).toBeNull();
  });
});
