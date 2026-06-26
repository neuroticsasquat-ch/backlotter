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
  it("shows the beat, confidence, date, summary, and sources", () => {
    render(<EventCard event={event} />);
    expect(screen.getByText("Release date")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.getByText("Mar 14, 2026")).toBeInTheDocument();
    expect(screen.getByText(/July 17 theatrical release/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "THR" })).toHaveAttribute("href", "https://thr.com/a");
    expect(document.querySelector("time")).toHaveAttribute("dateTime", "2026-03-14T00:00:00Z");
  });

  it("renders rumored confidence", () => {
    render(<EventCard event={{ ...event, confidence: "rumored" }} />);
    expect(screen.getByText("Rumored")).toBeInTheDocument();
  });

  it("renders unknown confidence as-is", () => {
    render(<EventCard event={{ ...event, confidence: "tbc" }} />);
    expect(screen.getByText("tbc")).toBeInTheDocument();
  });
});
