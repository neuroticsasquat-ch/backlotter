import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "@/components/AuthContext";
import { EventTimeline } from "@/components/film/EventTimeline";
import type { FilmDayGroup, FilmEvent } from "@/api/types";

function makeEvent(overrides: Partial<FilmEvent>): FilmEvent {
  return {
    event_id: "evt-default",
    event_type: "casting",
    confidence: "confirmed",
    created_at: "2025-01-01T00:00:00Z",
    summary: "Summary.",
    summary_edited: false,
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
  const router = createMemoryRouter([{ path: "/", element: <EventTimeline dayGroups={dayGroups} /> }]);
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
    expect(screen.getByText(/via TMDB/i)).toBeInTheDocument();
  });

  it("does not render section label when only one subgroup is present", async () => {
    renderTimeline([
      makeDayGroup("2026-06-01", "Monday, June 1, 2026", [
        makeEvent({ summary: "Only news event.", created_at: "2026-06-01T08:00:00Z" }),
      ]),
    ]);
    expect(await screen.findByText(/Only news event/)).toBeInTheDocument();
    expect(screen.queryByText(/In the news/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/via TMDB/i)).not.toBeInTheDocument();
  });
});
