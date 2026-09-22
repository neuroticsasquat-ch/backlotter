import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createRoutesStub } from "react-router";
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

  describe("credit links", () => {
    const identified: CrewMember[] = [
      { name: "Greta Gerwig", job: "Director", department: "Directing", person_id: 45400 },
      {
        name: "Linus Sandgren",
        job: "Director of Photography",
        department: "Camera",
        person_id: 1,
      },
    ];

    /** Bare stub, no query client — see the note on the cast block's. */
    function renderCrew(crew: CrewMember[]) {
      const Stub = createRoutesStub([{ path: "/", Component: () => <FilmCrew crew={crew} /> }]);
      return render(<Stub initialEntries={["/"]} />);
    }

    it("links every name to that person's page, whatever the job", async () => {
      // Including the cinematographer, who never had a button: a follow at the tier the row
      // could create would have put nothing on the reader's timeline for this film, so the
      // page listed them beside a director it *did* offer and said nothing about how to
      // follow them. The link says it (EF-16).
      renderCrew(identified);
      expect(await screen.findByRole("link", { name: "Greta Gerwig" })).toHaveAttribute(
        "href",
        "/person/45400-greta-gerwig",
      );
      expect(screen.getByRole("link", { name: "Linus Sandgren" })).toHaveAttribute(
        "href",
        "/person/1-linus-sandgren",
      );
    });

    it("carries no follow button on any row", () => {
      renderCrew(identified);
      expect(screen.queryAllByRole("button")).toHaveLength(0);
    });

    it("renders crew the payload does not identify as plain text", () => {
      const { container } = renderCrew(crew);
      expect(container.querySelectorAll("a")).toHaveLength(0);
      expect(container.querySelectorAll("button")).toHaveLength(0);
    });
  });
});
