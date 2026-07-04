import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "@/components/AuthContext";
import { EventTimeline } from "@/components/film/EventTimeline";
import type { FilmEvent } from "@/api/types";

function makeEvent(overrides: Partial<FilmEvent>): FilmEvent {
  return {
    event_id: "evt-default",
    event_type: "casting",
    confidence: "confirmed",
    created_at: "2025-01-01T00:00:00Z",
    summary: "Summary.",
    sources: [],
    ...overrides,
  };
}

/** Renders EventTimeline inside the full provider stack EventCard now requires
 *  (QueryClientProvider + AuthProvider + data router via createMemoryRouter). */
function renderTimeline(events: FilmEvent[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: "/", element: <EventTimeline events={events} /> }]);
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("EventTimeline", () => {
  it("renders the empty state when there are no events", async () => {
    renderTimeline([]);
    expect(await screen.findByText(/no updates yet/i)).toBeInTheDocument();
  });

  it("groups events by day, newest day first", async () => {
    // Ascending input (as the backend returns); the timeline flips it to newest-first.
    renderTimeline([
      makeEvent({ summary: "Casting announced.", created_at: "2025-01-01T00:00:00Z" }),
      makeEvent({
        summary: "Trailer dropped.",
        event_type: "trailer",
        created_at: "2026-06-01T00:00:00Z",
      }),
    ]);
    await waitFor(() => {
      const summaries = screen.getAllByText(/announced|dropped/);
      expect(summaries[0].textContent).toContain("Trailer dropped.");
      expect(summaries[1].textContent).toContain("Casting announced.");
    });
  });

  it("renders a day heading for each day", async () => {
    renderTimeline([
      makeEvent({ summary: "Casting announced.", created_at: "2025-01-01T00:00:00Z" }),
      makeEvent({
        summary: "Trailer dropped.",
        event_type: "trailer",
        created_at: "2026-06-01T00:00:00Z",
      }),
    ]);
    expect(await screen.findByText(/January 1, 2025/)).toBeInTheDocument();
    expect(screen.getByText(/June 1, 2026/)).toBeInTheDocument();
  });

  it("orders events within a day newest-first", async () => {
    renderTimeline([
      makeEvent({ summary: "Earlier today.", created_at: "2026-06-01T08:00:00Z" }),
      makeEvent({ summary: "Later today.", created_at: "2026-06-01T20:00:00Z" }),
    ]);
    await waitFor(() => {
      const summaries = screen.getAllByText(/today/);
      expect(summaries[0].textContent).toContain("Later today.");
      expect(summaries[1].textContent).toContain("Earlier today.");
    });
  });
});
