import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventTimeline } from "@/components/film/EventTimeline";
import type { FilmEvent } from "@/api/types";

function makeEvent(overrides: Partial<FilmEvent>): FilmEvent {
  return {
    event_type: "casting",
    confidence: "confirmed",
    occurred_at: "2025-01-01T00:00:00Z",
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

  it("renders events in the given (ascending) order", () => {
    render(
      <EventTimeline
        events={[
          makeEvent({ summary: "Casting announced.", occurred_at: "2025-01-01T00:00:00Z" }),
          makeEvent({
            summary: "Trailer dropped.",
            event_type: "trailer",
            occurred_at: "2026-06-01T00:00:00Z",
          }),
        ]}
      />,
    );
    const summaries = screen.getAllByText(/announced|dropped/).map((el) => el.textContent);
    expect(summaries).toEqual(["Casting announced.", "Trailer dropped."]);
  });
});
