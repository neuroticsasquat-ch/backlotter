import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { FeedDayCard } from "@/components/feed/FeedDayCard";
import type { FeedDayItem } from "@/api/types";

const item: FeedDayItem = {
  film_ref: "the-odyssey-2026",
  film_title: "The Odyssey",
  release_year: 2026,
  poster_path: "/odyssey.jpg",
  arc_stage: "shooting",
  production_countries: [],
  directors: [],
  day: "2026-06-23",
  top_event_type: "release_date",
  event_types: ["release_date"],
  event_count: 1,
  news_backed: false,
  events: [],
};

function renderCard(overrides: Partial<FeedDayItem> = {}) {
  render(
    <MemoryRouter>
      <FeedDayCard item={{ ...item, ...overrides }} />
    </MemoryRouter>,
  );
}

describe("FeedDayCard", () => {
  it("links the whole row to the film page and shows the title with its year", () => {
    renderCard();
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/film/the-odyssey-2026");
    expect(screen.getByText("The Odyssey")).toBeInTheDocument();
    expect(screen.getByText("(2026)")).toBeInTheDocument();
  });

  it("falls back to the arc-stage label only when country, director, and year are all absent", () => {
    // The last resort for the 2% of films carrying none of the three — a bare title with no
    // parenthetical at all would read as a rendering bug (NEU-1215).
    renderCard({ release_year: null, arc_stage: "announced" });
    expect(screen.queryByText(/\(\d{4}\)/)).toBeNull();
    expect(screen.getByText("(Announced)")).toBeInTheDocument();
  });

  it("composes country, director, and year into one parenthetical", () => {
    renderCard({
      film_title: "Inception",
      production_countries: ["USA"],
      directors: ["Christopher Nolan"],
      release_year: 2010,
    });
    expect(screen.getByText("(USA, Dir: Christopher Nolan, 2010)")).toBeInTheDocument();
  });

  it("drops the year element for an undated film that has a country and a director", () => {
    // The 78% case: no year, but the parenthetical still places the film.
    renderCard({
      release_year: null,
      arc_stage: "announced",
      production_countries: ["Japan"],
      directors: ["Ryusuke Hamaguchi"],
    });
    expect(screen.getByText("(Japan, Dir: Ryusuke Hamaguchi)")).toBeInTheDocument();
    expect(screen.queryByText(/Announced/)).toBeNull();
  });

  it("caps a co-production's countries and reports the remainder", () => {
    renderCard({
      production_countries: ["Canada", "Colombia", "France", "Mexico", "Netherlands"],
      directors: ["Apichatpong Weerasethakul"],
      release_year: null,
    });
    expect(
      screen.getByText("(Canada/Colombia/France +2, Dir: Apichatpong Weerasethakul)"),
    ).toBeInTheDocument();
  });

  it("keeps the year and omits the arc-stage label for a dated film", () => {
    renderCard();
    expect(screen.getByText("(2026)")).toBeInTheDocument();
    expect(screen.queryByText("(Shooting)")).toBeNull();
  });

  it("renders no poster image", () => {
    renderCard();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("stripes via a parent-scoped odd: selector, so each feed section restarts the pattern", () => {
    // NEU-1138 splits a day into two sibling lists. The stripe resets per section precisely
    // because it is CSS nth-child on the card's own parent, not an index passed in — so the
    // card takes no position prop, and adding one would silently change the day's appearance.
    // The container div carries the stripe; the inner link does not.
    const { container } = render(
      <MemoryRouter>
        <FeedDayCard item={item} />
      </MemoryRouter>,
    );
    const card = container.firstElementChild!;
    expect(card.className).toContain("odd:bg-muted/40");
  });

  it("labels every beat the film saw that day via event badges", () => {
    renderCard({
      events: [
        {
          event_id: "e1",
          event_type: "trailer",
          confidence: "confirmed",
          created_at: "2026-06-23T12:00:00Z",
          summary: "Trailer released.",
          summary_edited: false,
          provenance: "story",
          sources: [],
        },
        {
          event_id: "e2",
          event_type: "casting",
          confidence: "rumored",
          created_at: "2026-06-23T12:00:00Z",
          summary: "Actor cast.",
          summary_edited: false,
          provenance: "story",
          sources: [],
        },
      ],
    });
    expect(screen.getByText("Trailer")).toBeInTheDocument();
    expect(screen.getByText("Casting")).toBeInTheDocument();
  });

  it("shows a single event for a one-beat day", () => {
    renderCard({
      events: [
        {
          event_id: "e3",
          event_type: "release_date",
          confidence: "confirmed",
          created_at: "2026-06-23T12:00:00Z",
          summary: "Date set.",
          summary_edited: false,
          provenance: "story",
          sources: [],
        },
      ],
    });
    expect(screen.getByText("Release date")).toBeInTheDocument();
    expect(screen.queryByText("Trailer")).toBeNull();
  });

  it("renders beat labels when events are empty", () => {
    // NEU-1208 stopped shipping events for catalog rows; NEU-1212 puts the day's beats back
    // as badges, so the row is triageable without a page load. Still no count of any kind.
    renderCard({ event_count: 3, events: [], event_types: ["release_date"] });
    expect(screen.getByRole("link")).toHaveAttribute("href", "/film/the-odyssey-2026");
    expect(screen.getByText("Release date")).toBeInTheDocument();
    expect(screen.queryByText(/^\+/)).toBeNull();
    expect(screen.queryByText("3")).toBeNull();
    // The beats are labelled, but no event summary line renders for a catalog row — the
    // badge is the whole of the row's content beyond the title.
    expect(screen.queryByText("Date set.")).toBeNull();
    expect(screen.getByRole("link").parentElement!.querySelector("p")).toBeNull();
    // Nor any beat the row does not carry.
    expect(screen.queryByText("Trailer")).toBeNull();
    expect(screen.queryByText("Casting")).toBeNull();
  });

  it("renders a badge for every beat type, in the order the backend shipped them", () => {
    renderCard({ events: [], event_types: ["release_date", "casting"] });
    const badges = screen.getAllByText(/^(Release date|Casting)$/).map((el) => el.textContent);
    expect(badges).toEqual(["Release date", "Casting"]);
  });

  it("renders no beat labels on a row that has events", () => {
    // A row shows either its beats or its event cards, never both — so the type label
    // appears exactly once, from the event card.
    renderCard({
      event_types: ["release_date"],
      events: [
        {
          event_id: "evt-3",
          event_type: "release_date",
          confidence: "confirmed",
          created_at: "2026-06-23T12:00:00Z",
          summary: "Date set.",
          summary_edited: false,
          provenance: "story",
          sources: [],
        },
      ],
    });
    expect(screen.getAllByText("Release date")).toHaveLength(1);
  });

  it("renders the beat labels inside the title link", () => {
    renderCard({ events: [], event_types: ["release_date"] });
    expect(within(screen.getByRole("link")).getByText("Release date")).toBeInTheDocument();
  });

  it("separates consecutive beat pills by more than their own inner padding", () => {
    // The pill's px-1.5 is 6px, and its bg sits ~10 RGB points off the row's, so its edge is
    // near-invisible. A gap narrower than that padding reads as a word space and two pills
    // merge into one chip (NEU-1213). ml-1 — the news-card value, which is fine before prose
    // but not between identical pills — is what regressed here, so pin the wider margin.
    renderCard({ events: [], event_types: ["release_date", "casting"] });
    for (const label of ["Release date", "Casting"]) {
      expect(screen.getByText(label).className).toContain("ml-2");
      expect(screen.getByText(label).className).not.toContain("ml-1");
    }
  });

  it("cancels the title link's inherited negative text-indent on the beat pill", () => {
    // The Link carries -indent-3 for the title's hanging indent, and text-indent inherits.
    // Each inline-block badge re-applies it to its own first line, painting the label 6px
    // outside the left edge of its own background — which also ate the gap to the year
    // parenthetical and to the preceding pill (NEU-1214). jsdom has no layout, so pin the
    // class; the geometry it buys was verified in the browser.
    renderCard({ events: [], event_types: ["release_date", "casting"] });
    for (const label of ["Release date", "Casting"]) {
      expect(screen.getByText(label).className).toContain("indent-0");
    }
  });

  it("keeps the badge indent fix on a row with a long parenthetical", () => {
    // A three-country, two-director parenthetical pushes the title line to wrap far more
    // often, which is exactly where NEU-1214's -indent-3 / indent-0 pairing shows. The
    // parenthetical is plain text inside the link, so the pairing must be untouched.
    renderCard({
      film_title: "Jenjira's Magnificent Dream",
      production_countries: ["Canada", "Colombia", "France", "Mexico"],
      directors: ["Ann Director", "Bob Director", "Cal Director"],
      release_year: 2026,
      events: [],
      event_types: ["release_date"],
    });
    expect(
      screen.getByText("(Canada/Colombia/France +1, Dir: Ann Director/Bob Director +1, 2026)"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link").className).toContain("-indent-3");
    expect(screen.getByText("Release date").className).toContain("indent-0");
  });

  it("keeps the hanging indent on the link, not on the badges", () => {
    // -indent-3 has to stay on the Link: it is what makes a wrapped long title's second
    // line hang. Cancelling it on the badge must not cancel it on the title.
    renderCard({
      film_title: "Untitled Shang-Chi and the Legend of the Ten Rings Sequel",
      events: [],
      event_types: ["release_date"],
    });
    expect(screen.getByRole("link").className).toContain("-indent-3");
    expect(screen.getByText("Release date").className).not.toContain("-indent-3");
  });

  it("leaves the news-card event badge on mr-1", () => {
    // NEU-1213 widens the *beat* pill only. The event badge is followed by summary prose,
    // where 4px is right — widening it too would be the scope creep that ticket excluded.
    renderCard({
      events: [
        {
          event_id: "evt-4",
          event_type: "trailer",
          confidence: "confirmed",
          created_at: "2026-06-23T12:00:00Z",
          summary: "Trailer released.",
          summary_edited: false,
          provenance: "story",
          sources: [],
        },
      ],
    });
    expect(screen.getByText("Trailer").className).toContain("mr-1");
  });

  it("wraps a long title instead of truncating it", () => {
    // The mobile column is ~300px wide, so truncation hides most of a long title. The
    // hanging indent on the wrapped lines is what keeps line two from reading as its own row.
    renderCard({ film_title: "Untitled Shang-Chi and the Legend of the Ten Rings Sequel" });
    const link = screen.getByRole("link");
    expect(link.className).not.toContain("truncate");
    expect(screen.getByText(/^Untitled Shang-Chi/).className).toContain("-indent-3");
  });

  it("renders events with summary text and type badge", () => {
    renderCard({
      events: [
        {
          event_id: "evt-1",
          event_type: "trailer",
          confidence: "confirmed",
          created_at: "2026-06-23T12:00:00Z",
          summary: "The official trailer was released.",
          summary_edited: false,
          provenance: "story",
          sources: [],
        },
      ],
    });
    expect(screen.getByText("Trailer")).toBeInTheDocument();
    expect(screen.getByText("The official trailer was released.")).toBeInTheDocument();
  });

  it("renders source chips for an event with sources", () => {
    renderCard({
      events: [
        {
          event_id: "evt-2",
          event_type: "casting",
          confidence: "rumored",
          created_at: "2026-06-23T12:00:00Z",
          summary: "New actor cast.",
          summary_edited: false,
          provenance: "story",
          sources: [
            {
              url: "https://deadline.com/article",
              source: "Deadline",
              title: "Exclusive",
              published_at: null,
            },
          ],
        },
      ],
    });
    expect(screen.getByText("Deadline")).toBeInTheDocument();
  });
});
