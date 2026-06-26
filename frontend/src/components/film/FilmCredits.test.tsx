import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FilmCredits } from "@/components/film/FilmCredits";
import type { CastMember } from "@/api/types";

const castWithImage: CastMember = {
  name: "Timothée Chalamet",
  character: "Paul Atreides",
  profile_path: "/timothee.jpg",
};

const castNoImage: CastMember = {
  name: "Zendaya Coleman",
  character: "Chani",
  profile_path: null,
};

const castNullCharacter: CastMember = {
  name: "Rebecca Ferguson",
  character: null,
  profile_path: null,
};

describe("FilmCredits", () => {
  describe("director line", () => {
    it("shows the director name when one director is present", () => {
      render(<FilmCredits directors={["Denis Villeneuve"]} cast={[]} />);
      expect(screen.getByText(/Denis Villeneuve/)).toBeInTheDocument();
      expect(screen.getByText(/Directed by/i)).toBeInTheDocument();
    });

    it("shows both names when two directors are present", () => {
      render(<FilmCredits directors={["Denis Villeneuve", "Jon Spaihts"]} cast={[]} />);
      expect(screen.getByText(/Denis Villeneuve/)).toBeInTheDocument();
      expect(screen.getByText(/Jon Spaihts/)).toBeInTheDocument();
    });
  });

  describe("cast cards", () => {
    it("renders an img with profileUrl src and name alt for a cast member with profile_path", () => {
      render(<FilmCredits directors={[]} cast={[castWithImage]} />);
      const img = screen.getByRole("img", { name: "Timothée Chalamet" });
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute("src", "https://image.tmdb.org/t/p/w185/timothee.jpg");
      expect(screen.getByText("Paul Atreides")).toBeInTheDocument();
    });

    it("renders a placeholder (no img) for a cast member with null profile_path", () => {
      render(<FilmCredits directors={[]} cast={[castNoImage]} />);
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      expect(screen.getByTestId("cast-avatar-placeholder")).toBeInTheDocument();
      expect(screen.getByText("Zendaya Coleman")).toBeInTheDocument();
    });

    it("renders the name with no stray empty node when character is null", () => {
      const { container } = render(<FilmCredits directors={[]} cast={[castNullCharacter]} />);
      expect(screen.getByText("Rebecca Ferguson")).toBeInTheDocument();
      // The character paragraph should not be present — only the name <p> should exist in the card
      const paragraphs = container.querySelectorAll("li p");
      expect(paragraphs).toHaveLength(1);
      expect(paragraphs[0].textContent).toBe("Rebecca Ferguson");
    });
  });

  describe("empty state", () => {
    it("renders nothing when both directors and cast are empty", () => {
      const { container } = render(<FilmCredits directors={[]} cast={[]} />);
      expect(container).toBeEmptyDOMElement();
    });
  });
});
