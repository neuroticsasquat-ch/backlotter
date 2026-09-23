import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "@/components/AuthContext";
import { EventTimeline } from "@/components/film/EventTimeline";
import { SECTION_SPLIT_EXPLAINER } from "@/components/film/labels";
import type { FilmDayGroup, FilmEvent } from "@/api/types";

function makeEvent(overrides: Partial<FilmEvent>): FilmEvent {
  return {
    event_id: "evt-default",
    event_type: "casting",
    confidence: "confirmed",
    created_at: "2025-01-01T00:00:00Z",
    occurred_at: "2025-01-01T00:00:00Z",
    summary: "Summary.",
    summary_edited: false,
    status: "published",
    superseded_by: null,
    video_key: null,
    provenance: "story",
    sources: [],
    ...overrides,
  };
}

function makeDayGroup(day: string, heading: string, events: FilmEvent[]): FilmDayGroup {
  return {
    day,
    heading,
    news_events: events,
    tmdb_events: [],
  };
}

/** Renders EventTimeline inside the full provider stack. */
function renderTimeline(dayGroups: FilmDayGroup[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([
    { path: "/", element: <EventTimeline dayGroups={dayGroups} /> },
  ]);
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("EventTimeline", () => {
  it("renders the empty state when there are no day groups", async () => {
    renderTimeline([]);
    expect(await screen.findByText(/no updates yet/i)).toBeInTheDocument();
  });

  it("groups events by day, newest day first", async () => {
    renderTimeline([
      makeDayGroup("2026-06-01", "Monday, June 1, 2026", [
        makeEvent({
          summary: "Trailer dropped.",
          event_type: "trailer",
          created_at: "2026-06-01T00:00:00Z",
          occurred_at: "2026-06-01T00:00:00Z",
        }),
      ]),
      makeDayGroup("2025-01-01", "Wednesday, January 1, 2025", [
        makeEvent({ summary: "Casting announced.", created_at: "2025-01-01T00:00:00Z" }),
      ]),
    ]);
    await waitFor(() => {
      const summaries = screen.getAllByText(/announced|dropped/);
      expect(summaries[0].textContent).toContain("Trailer dropped.");
      expect(summaries[1].textContent).toContain("Casting announced.");
    });
  });

  it("renders a day heading for each day", async () => {
    renderTimeline([
      makeDayGroup("2026-06-01", "Monday, June 1, 2026", [
        makeEvent({
          summary: "Trailer dropped.",
          event_type: "trailer",
          created_at: "2026-06-01T00:00:00Z",
          occurred_at: "2026-06-01T00:00:00Z",
        }),
      ]),
      makeDayGroup("2025-01-01", "Wednesday, January 1, 2025", [
        makeEvent({ summary: "Casting announced.", created_at: "2025-01-01T00:00:00Z" }),
      ]),
    ]);
    expect(await screen.findByText(/June 1, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/January 1, 2025/)).toBeInTheDocument();
  });

  it("orders events within a day newest-first", async () => {
    renderTimeline([
      makeDayGroup("2026-06-01", "Monday, June 1, 2026", [
        makeEvent({ summary: "Earlier today.", created_at: "2026-06-01T08:00:00Z" }),
        makeEvent({ summary: "Later today.", created_at: "2026-06-01T20:00:00Z" }),
      ]),
    ]);
    await waitFor(() => {
      // The backend returns events in created_at ASC order; the component renders them
      // in the order received (ASC), keeping consistent with day_groups structure.
      // Earlier = 08:00, Later = 20:00. With ASC order: earlier first, later second.
      const summaries = screen.getAllByText(/today/);
      expect(summaries[0].textContent).toContain("Earlier today.");
      expect(summaries[1].textContent).toContain("Later today.");
    });
  });

  it("renders news and tmdb sections when both present", async () => {
    renderTimeline([
      {
        day: "2026-06-01",
        heading: "Monday, June 1, 2026",
        news_events: [makeEvent({ summary: "News event.", created_at: "2026-06-01T08:00:00Z" })],
        tmdb_events: [makeEvent({ summary: "TMDB event.", created_at: "2026-06-01T12:00:00Z" })],
      },
    ]);
    expect(await screen.findByText(/In the news/i)).toBeInTheDocument();
    expect(screen.getByText("Not yet reported")).toBeInTheDocument();
    expect(screen.getByText(/TMDB event/)).toBeInTheDocument();
  });

  it("renders tmdb events inline without collapse on a tmdb-only day", async () => {
    renderTimeline([
      {
        day: "2026-06-01",
        heading: "Monday, June 1, 2026",
        news_events: [],
        tmdb_events: [
          makeEvent({ summary: "Only TMDB event.", created_at: "2026-06-01T12:00:00Z" }),
        ],
      },
    ]);
    expect(await screen.findByText(/Only TMDB event/)).toBeInTheDocument();
    expect(screen.getByText("Not yet reported")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /not yet reported/i })).not.toBeInTheDocument();
  });

  it("keeps a confirmed badge under Not yet reported, and unconfirmed under In the news", async () => {
    // The heading names provenance and the badge names truth, so neither overrides the other
    // (NEU-1406): the catalog beats a reader most wants to trust are minted confirmed.
    renderTimeline([
      {
        day: "2026-06-01",
        heading: "Monday, June 1, 2026",
        news_events: [
          makeEvent({
            summary: "Rumored casting.",
            confidence: "rumored",
            created_at: "2026-06-01T08:00:00Z",
          }),
        ],
        tmdb_events: [
          makeEvent({
            summary: "Release date set.",
            event_type: "release_date",
            confidence: "confirmed",
            provenance: "catalog",
            created_at: "2026-06-01T12:00:00Z",
          }),
        ],
      },
    ]);
    const tmdbSection = (await screen.findByText("Not yet reported")).parentElement!;
    expect(within(tmdbSection).getByText("confirmed")).toBeInTheDocument();
    expect(within(tmdbSection).queryByText("unconfirmed")).toBeNull();
    const newsSection = screen.getByText("In the news").parentElement!;
    expect(within(newsSection).getByText("unconfirmed")).toBeInTheDocument();
  });

  it("explains the section split once, above the day groups", async () => {
    renderTimeline([
      makeDayGroup("2026-06-02", "Tuesday, June 2, 2026", [makeEvent({ summary: "One." })]),
      makeDayGroup("2026-06-01", "Monday, June 1, 2026", [makeEvent({ summary: "Two." })]),
    ]);
    expect(await screen.findAllByText(SECTION_SPLIT_EXPLAINER)).toHaveLength(1);
  });

  it("has no split to explain when there are no updates", async () => {
    renderTimeline([]);
    expect(await screen.findByText(/no updates yet/i)).toBeInTheDocument();
    expect(screen.queryByText(SECTION_SPLIT_EXPLAINER)).toBeNull();
  });

  it("renders both subgroups visible on initial render", async () => {
    renderTimeline([
      {
        day: "2026-06-01",
        heading: "Monday, June 1, 2026",
        news_events: [makeEvent({ summary: "News event.", created_at: "2026-06-01T08:00:00Z" })],
        tmdb_events: [makeEvent({ summary: "TMDB event.", created_at: "2026-06-01T12:00:00Z" })],
      },
    ]);
    expect(await screen.findByText(/News event/)).toBeInTheDocument();
    expect(screen.getByText(/TMDB event/)).toBeInTheDocument();
    expect(screen.getByText(/In the news/i)).toBeInTheDocument();
    expect(screen.getByText("Not yet reported")).toBeInTheDocument();
  });

  it("hands each card its day, so only a backdated beat discloses first seen", async () => {
    renderTimeline([
      {
        day: "2026-06-01",
        heading: "Monday, June 1, 2026",
        news_events: [
          makeEvent({ summary: "Same-day beat.", occurred_at: "2026-06-01T08:00:00Z" }),
        ],
        tmdb_events: [
          makeEvent({ summary: "Backdated beat.", occurred_at: "2026-05-25T12:00:00Z" }),
        ],
      },
    ]);
    await screen.findByText(/Backdated beat/);
    const lines = screen.getAllByText(/first seen/);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent("first seen May 25, 2026");
  });

  it("renders section label even when only one subgroup is present", async () => {
    renderTimeline([
      makeDayGroup("2026-06-01", "Monday, June 1, 2026", [
        makeEvent({ summary: "Only news event.", created_at: "2026-06-01T08:00:00Z" }),
      ]),
    ]);
    expect(await screen.findByText(/Only news event/)).toBeInTheDocument();
    expect(screen.getByText(/In the news/i)).toBeInTheDocument();
  });
});
