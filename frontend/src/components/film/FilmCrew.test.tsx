import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoutesStub } from "react-router";
import { AuthProvider } from "@/components/AuthContext";
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

  describe("follow buttons", () => {
    const identified: CrewMember[] = [
      { name: "Greta Gerwig", job: "Director", department: "Directing", person_id: 45400 },
      {
        name: "Linus Sandgren",
        job: "Director of Photography",
        department: "Camera",
        person_id: 1,
      },
    ];

    it("offers one on a seed-grade credit and none on the rest", async () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const Stub = createRoutesStub([
        { path: "/", Component: () => <FilmCrew crew={identified} /> },
      ]);
      render(
        <QueryClientProvider client={qc}>
          <AuthProvider>
            <Stub initialEntries={["/"]} />
          </AuthProvider>
        </QueryClientProvider>,
      );

      // A director follow puts this film's events on the timeline (D-11); a cinematographer
      // follow at the tier this button creates would not, so that row gets no button. It is
      // still a link to their page, where a reader who does want them can pick a tier that
      // reaches this film (NEU-1419) — which is the whole reason the button stays lead-shaped.
      expect(
        await screen.findByRole("link", { name: /sign in to follow greta gerwig/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: /sign in to follow linus sandgren/i }),
      ).not.toBeInTheDocument();
    });

    it("links every name to that person's page, button or not", async () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const Stub = createRoutesStub([
        { path: "/", Component: () => <FilmCrew crew={identified} /> },
      ]);
      render(
        <QueryClientProvider client={qc}>
          <AuthProvider>
            <Stub initialEntries={["/"]} />
          </AuthProvider>
        </QueryClientProvider>,
      );

      expect(await screen.findByRole("link", { name: "Greta Gerwig" })).toHaveAttribute(
        "href",
        "/person/45400-greta-gerwig",
      );
      expect(screen.getByRole("link", { name: "Linus Sandgren" })).toHaveAttribute(
        "href",
        "/person/1-linus-sandgren",
      );
    });

    it("renders no button and no link for crew the payload does not identify", () => {
      const { container } = render(<FilmCrew crew={crew} />);
      expect(container.querySelectorAll("a")).toHaveLength(0);
      expect(container.querySelectorAll("button")).toHaveLength(0);
    });
  });
});
