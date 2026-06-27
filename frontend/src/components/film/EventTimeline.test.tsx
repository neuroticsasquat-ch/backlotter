import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventTimeline } from "@/components/film/EventTimeline";
import type { FilmEvent } from "@/api/types";

function makeEvent(overrides: Partial<FilmEvent>): FilmEvent {
  return {
    event_type: "casting",
    confidence: "confirmed",
    created_at: "2025-01-01T00:00:00Z",
    summary: "Summary.",
    sources: [],
    ...overrides,
  };
}

describe("EventTimeline", () => {
  it("renders the empty state when there are no events", () => {
    render(<EventTimeline events={[]} />);
    expect(screen.getByText(/no updates yet/i)).toBeInTheDocument();
  });

  it("groups events by day, newest day first", () => {
    // Ascending input (as the backend returns); the timeline flips it to newest-first.
    render(
      <EventTimeline
        events={[
          makeEvent({ summary: "Casting announced.", created_at: "2025-01-01T00:00:00Z" }),
          makeEvent({
            summary: "Trailer dropped.",
            event_type: "trailer",
            created_at: "2026-06-01T00:00:00Z",
          }),
        ]}
      />,
    );
    const summaries = screen.getAllByText(/announced|dropped/);
    expect(summaries[0].textContent).toContain("Trailer dropped.");
    expect(summaries[1].textContent).toContain("Casting announced.");
  });

  it("renders a day heading for each day", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({ summary: "Casting announced.", created_at: "2025-01-01T00:00:00Z" }),
          makeEvent({
            summary: "Trailer dropped.",
            event_type: "trailer",
            created_at: "2026-06-01T00:00:00Z",
          }),
        ]}
      />,
    );
    expect(screen.getByText(/January 1, 2025/)).toBeInTheDocument();
    expect(screen.getByText(/June 1, 2026/)).toBeInTheDocument();
  });

  it("orders events within a day newest-first", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({ summary: "Earlier today.", created_at: "2026-06-01T08:00:00Z" }),
          makeEvent({ summary: "Later today.", created_at: "2026-06-01T20:00:00Z" }),
        ]}
      />,
    );
    const summaries = screen.getAllByText(/today/);
    expect(summaries[0].textContent).toContain("Later today.");
    expect(summaries[1].textContent).toContain("Earlier today.");
  });
});
