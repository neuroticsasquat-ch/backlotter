import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FilmCredits } from "@/components/film/FilmCredits";
import type { CastMember } from "@/api/types";

const castWithCharacter: CastMember = {
  name: "Timothée Chalamet",
  character: "Paul Atreides",
  profile_path: "/timothee.jpg",
};

const castNullCharacter: CastMember = {
  name: "Rebecca Ferguson",
  character: null,
  profile_path: null,
};

describe("FilmCredits", () => {
  it("renders the Cast heading", () => {
    render(<FilmCredits cast={[castWithCharacter]} />);
    expect(screen.getByRole("heading", { name: "Cast" })).toBeInTheDocument();
  });

  it("renders the actor and character on one line, with no photo", () => {
    const { container } = render(<FilmCredits cast={[castWithCharacter]} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    const li = container.querySelector("li");
    expect(li?.textContent).toBe("Timothée Chalamet · Paul Atreides");
  });

  it("renders only the actor name when character is null", () => {
    const { container } = render(<FilmCredits cast={[castNullCharacter]} />);
    const li = container.querySelector("li");
    expect(li?.textContent).toBe("Rebecca Ferguson");
  });

  describe("empty state", () => {
    it("renders nothing when cast is empty", () => {
      const { container } = render(<FilmCredits cast={[]} />);
      expect(container).toBeEmptyDOMElement();
    });
  });
});
