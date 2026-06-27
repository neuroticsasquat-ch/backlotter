import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventCard } from "@/components/film/EventCard";
import type { FilmEvent } from "@/api/types";

const event: FilmEvent = {
  event_type: "release_date",
  confidence: "confirmed",
  created_at: "2026-03-14T00:00:00Z",
  summary: "Studio sets a July 17 theatrical release.",
  sources: [{ url: "https://thr.com/a", source: "THR", title: "Dated", published_at: null }],
};

describe("EventCard", () => {
  it("shows the beat, summary, and source links", () => {
    render(<EventCard event={event} />);
    expect(screen.getByText("Release date")).toBeInTheDocument();
    expect(screen.getByText(/July 17 theatrical release/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "THR" })).toHaveAttribute("href", "https://thr.com/a");
  });

  it("omits the per-event date and confidence (the day heading carries the date)", () => {
    render(<EventCard event={event} />);
    expect(screen.queryByText("Confirmed")).not.toBeInTheDocument();
    expect(screen.queryByText("Mar 14, 2026")).not.toBeInTheDocument();
    expect(document.querySelector("time")).toBeNull();
  });
});
