import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AlsoKnownAs } from "@/components/film/AlsoKnownAs";

describe("AlsoKnownAs", () => {
  describe("with multiple titles", () => {
    it("renders an 'Also known as' label", () => {
      render(<AlsoKnownAs titles={["Odysseia", "Οδύσσεια"]} />);
      expect(screen.getByText(/also known as/i)).toBeInTheDocument();
    });

    it("renders all titles joined by a comma and space", () => {
      render(<AlsoKnownAs titles={["Odysseia", "Οδύσσεια"]} />);
      expect(screen.getByText("Odysseia, Οδύσσεια")).toBeInTheDocument();
    });

    it("renders non-Latin characters intact", () => {
      render(<AlsoKnownAs titles={["Odysseia", "Οδύσσεια"]} />);
      expect(screen.getByText("Odysseia, Οδύσσεια")).toBeInTheDocument();
    });
  });

  describe("with a single title", () => {
    it("renders the title with no leading or trailing separator", () => {
      render(<AlsoKnownAs titles={["Odysseia"]} />);
      expect(screen.getByText("Odysseia")).toBeInTheDocument();
      // Ensure no stray comma appears anywhere in the rendered output
      expect(screen.queryByText(/,/)).toBeNull();
    });
  });

  describe("empty case", () => {
    it("renders nothing when titles is empty", () => {
      const { container } = render(<AlsoKnownAs titles={[]} />);
      expect(container).toBeEmptyDOMElement();
    });
  });
});
