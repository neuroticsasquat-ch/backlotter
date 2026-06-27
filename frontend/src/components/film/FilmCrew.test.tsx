import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FilmCrew } from "@/components/film/FilmCrew";
import type { CrewMember } from "@/api/types";

const crew: CrewMember[] = [
  { name: "Greta Gerwig", job: "Director", department: "Directing" },
  { name: "Greta Gerwig", job: "Screenplay", department: "Writing" },
  { name: "Noah Baumbach", job: "Screenplay", department: "Writing" },
];

describe("FilmCrew", () => {
  it("renders the Crew heading with a count", () => {
    render(<FilmCrew crew={crew} />);
    expect(screen.getByRole("heading", { name: "Crew" })).toBeInTheDocument();
    expect(screen.getByText("(3)")).toBeInTheDocument();
  });

  it("renders a job label with its people listed below", () => {
    render(<FilmCrew crew={crew} />);
    expect(screen.getByText("Director")).toBeInTheDocument();
    // "Screenplay" job label groups both writers
    expect(screen.getByText("Screenplay")).toBeInTheDocument();
    expect(screen.getByText("Noah Baumbach")).toBeInTheDocument();
  });

  it("renders nothing when crew is empty", () => {
    const { container } = render(<FilmCrew crew={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
