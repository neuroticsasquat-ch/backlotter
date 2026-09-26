import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createRoutesStub } from "react-router";
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

  describe("credit links", () => {
    const billed: CastMember[] = Array.from({ length: 6 }, (_, i): CastMember => ({
      name: `Actor ${i + 1}`,
      character: null,
      profile_path: null,
      person_id: i + 1,
    }));

    /** No `QueryClientProvider` and no `AuthProvider`, deliberately: a follow hook left on one
     *  of these rows would throw for want of a query client rather than quietly rendering, so
     *  the bare stub is the assertion that the buttons are gone (EF-16). */
    function renderCast(cast: CastMember[]) {
      const Stub = createRoutesStub([{ path: "/", Component: () => <FilmCredits cast={cast} /> }]);
      return render(<Stub initialEntries={["/"]} />);
    }

    it("links every name to that person's page, at any billing", async () => {
      // No cut-off any more. The billed rows used to be the only ones with a button, on D-11's
      // seed grade, which made the page assert that a 6th-billed actor was not worth
      // following; the person page is where that is decided now (EF-16, EF-18).
      renderCast(billed);
      expect(await screen.findByRole("link", { name: "Actor 1" })).toHaveAttribute(
        "href",
        "/person/1-actor-1",
      );
      expect(screen.getByRole("link", { name: "Actor 6" })).toHaveAttribute(
        "href",
        "/person/6-actor-6",
      );
    });

    it("carries no follow button on any row", () => {
      renderCast(billed);
      expect(screen.queryAllByRole("button")).toHaveLength(0);
    });

    it("renders cast the payload does not identify as plain text", () => {
      const { container } = renderCast([castWithCharacter]);
      expect(container.querySelectorAll("a")).toHaveLength(0);
      expect(screen.getByText(/Timothée Chalamet/)).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("renders nothing when cast is empty", () => {
      const { container } = render(<FilmCredits cast={[]} />);
      expect(container).toBeEmptyDOMElement();
    });
  });
});
