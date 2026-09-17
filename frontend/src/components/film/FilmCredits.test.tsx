import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoutesStub } from "react-router";
import { AuthProvider } from "@/components/AuthContext";
import { FOLLOWABLE_CAST_COUNT } from "@/lib/film-entities";
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

  describe("follow buttons", () => {
    // One more than the page offers a button for, each identified, so the cut-off is the
    // billing rule rather than a missing id.
    const billed: CastMember[] = Array.from(
      { length: FOLLOWABLE_CAST_COUNT + 1 },
      (_, i): CastMember => ({
        name: `Actor ${i + 1}`,
        character: null,
        profile_path: null,
        person_id: i + 1,
      }),
    );

    function renderCast(cast: CastMember[]) {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const Stub = createRoutesStub([{ path: "/", Component: () => <FilmCredits cast={cast} /> }]);
      return render(
        <QueryClientProvider client={qc}>
          <AuthProvider>
            <Stub initialEntries={["/"]} />
          </AuthProvider>
        </QueryClientProvider>,
      );
    }

    it("stops at the top billed rows", async () => {
      renderCast(billed);
      expect(await screen.findByRole("link", { name: /follow actor 1/i })).toBeInTheDocument();
      expect(
        screen.getByRole("link", {
          name: new RegExp(`follow actor ${FOLLOWABLE_CAST_COUNT}`, "i"),
        }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("link", {
          name: new RegExp(`follow actor ${FOLLOWABLE_CAST_COUNT + 1}`, "i"),
        }),
      ).not.toBeInTheDocument();
    });

    it("offers none for cast the payload does not identify", () => {
      const { container } = renderCast([castWithCharacter]);
      expect(container.querySelectorAll("a")).toHaveLength(0);
    });
  });

  describe("empty state", () => {
    it("renders nothing when cast is empty", () => {
      const { container } = render(<FilmCredits cast={[]} />);
      expect(container).toBeEmptyDOMElement();
    });
  });
});
