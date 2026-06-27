import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReleaseDates } from "@/components/film/ReleaseDates";
import type { ReleaseDate } from "@/api/types";

/** Two US rows of different types + one GB (origin-country) row. */
const multiCountryDates: ReleaseDate[] = [
  {
    country: "US",
    release_type: 3,
    type_label: "Theatrical (limited)",
    date: "2026-06-25T00:00:00Z",
    certification: "PG-13",
  },
  {
    country: "US",
    release_type: 4,
    type_label: "Digital",
    date: "2026-06-25T23:30:00Z", // late-UTC instant — must NOT roll to Jun 26
    certification: "",
  },
  {
    country: "GB",
    release_type: 3,
    type_label: "Theatrical (limited)",
    date: "2026-07-04T00:00:00Z",
    certification: null,
  },
];

/** Single-country slice (no GB row). */
const singleCountryDates: ReleaseDate[] = [
  {
    country: "US",
    release_type: 3,
    type_label: "Theatrical (limited)",
    date: "2026-06-25T00:00:00Z",
    certification: "PG-13",
  },
  {
    country: "US",
    release_type: 4,
    type_label: "Digital",
    date: "2026-08-12T00:00:00Z",
    certification: null,
  },
];

describe("ReleaseDates", () => {
  describe("with multiple countries", () => {
    it("renders a section heading", () => {
      render(<ReleaseDates dates={multiCountryDates} />);
      expect(screen.getByRole("heading", { name: /release dates/i })).toBeInTheDocument();
    });

    it("shows type_label for each row", () => {
      render(<ReleaseDates dates={multiCountryDates} />);
      expect(screen.getAllByText("Theatrical (limited)")).toHaveLength(2);
      expect(screen.getByText("Digital")).toBeInTheDocument();
    });

    it("shows UTC-formatted date in a <time dateTime={iso}> element", () => {
      render(<ReleaseDates dates={multiCountryDates} />);
      // Two rows share Jun 25 — getAllByText to avoid "multiple elements" error
      expect(screen.getAllByText("Jun 25, 2026")).toHaveLength(2);
      expect(screen.getByText("Jul 4, 2026")).toBeInTheDocument();
      // Verify <time> elements carry the ISO datetime attribute
      const timeEls = document.querySelectorAll("time[dateTime]");
      const dateTimes = Array.from(timeEls).map((el) => el.getAttribute("dateTime"));
      expect(dateTimes).toContain("2026-06-25T00:00:00Z");
      expect(dateTimes).toContain("2026-07-04T00:00:00Z");
    });

    it("late-UTC instant (T23:30:00Z) does NOT roll the day — stays Jun 25", () => {
      render(<ReleaseDates dates={multiCountryDates} />);
      // The Digital row has date 2026-06-25T23:30:00Z — must display as Jun 25, NOT Jun 26
      const timeEl = document.querySelector('time[dateTime="2026-06-25T23:30:00Z"]');
      expect(timeEl).not.toBeNull();
      expect(timeEl?.textContent).toBe("Jun 25, 2026");
    });

    it("does not render the certification on release-date rows", () => {
      render(<ReleaseDates dates={multiCountryDates} />);
      expect(screen.queryByText("PG-13")).not.toBeInTheDocument();
    });

    it("shows country tag for each row when multiple distinct countries", () => {
      render(<ReleaseDates dates={multiCountryDates} />);
      // There are two "US" rows and one "GB" row
      expect(screen.getAllByText("US")).toHaveLength(2);
      expect(screen.getByText("GB")).toBeInTheDocument();
    });
  });

  describe("with a single country", () => {
    it("renders a section heading", () => {
      render(<ReleaseDates dates={singleCountryDates} />);
      expect(screen.getByRole("heading", { name: /release dates/i })).toBeInTheDocument();
    });

    it("does NOT require country tags when all rows share one country", () => {
      render(<ReleaseDates dates={singleCountryDates} />);
      // The country tag is optional in the single-country case — assert it's absent
      expect(screen.queryByText("US")).not.toBeInTheDocument();
    });
  });

  describe("empty case", () => {
    it("renders nothing when dates is empty", () => {
      const { container } = render(<ReleaseDates dates={[]} />);
      expect(container.firstChild).toBeNull();
      expect(screen.queryByRole("heading", { name: /release dates/i })).toBeNull();
    });
  });
});
