import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createRoutesStub } from "react-router";
import { ProductionCompanies } from "@/components/film/ProductionCompanies";

describe("ProductionCompanies", () => {
  it("renders the heading with a count", () => {
    render(
      <ProductionCompanies companies={[{ name: "Universal Pictures" }, { name: "Blumhouse" }]} />,
    );
    expect(screen.getByRole("heading", { name: "Companies" })).toBeInTheDocument();
    expect(screen.getByText("(2)")).toBeInTheDocument();
  });

  it("is collapsed by default", () => {
    const { container } = render(
      <ProductionCompanies companies={[{ name: "Universal Pictures" }]} />,
    );
    expect(container.querySelector("details")).not.toHaveAttribute("open");
  });

  it("renders one company per line", () => {
    const { container } = render(
      <ProductionCompanies companies={[{ name: "Universal Pictures" }, { name: "Blumhouse" }]} />,
    );
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toBe("Universal Pictures");
    expect(items[1]?.textContent).toBe("Blumhouse");
  });

  it("renders nothing when there are no companies", () => {
    const { container } = render(<ProductionCompanies companies={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  describe("studio links", () => {
    /** Bare stub, no query client — see the note on the cast block's. */
    function renderCompanies(ui: React.ReactElement) {
      const Stub = createRoutesStub([{ path: "/", Component: () => ui }]);
      return render(<Stub initialEntries={["/"]} />);
    }

    it("links an identified company to its studio page", async () => {
      renderCompanies(<ProductionCompanies companies={[{ id: 33, name: "Universal Pictures" }]} />);
      expect(await screen.findByRole("link", { name: "Universal Pictures" })).toHaveAttribute(
        "href",
        "/studio/33-universal-pictures",
      );
    });

    it("carries no follow button — the studio page holds it now (EF-16)", () => {
      renderCompanies(<ProductionCompanies companies={[{ id: 33, name: "Universal Pictures" }]} />);
      expect(screen.queryAllByRole("button")).toHaveLength(0);
    });

    it("leaves a company the payload cannot identify unlinked", () => {
      // A link here would point at `/studio/undefined`.
      renderCompanies(<ProductionCompanies companies={[{ name: "Universal Pictures" }]} />);
      expect(screen.queryByRole("link", { name: "Universal Pictures" })).not.toBeInTheDocument();
      expect(screen.getByText("Universal Pictures")).toBeInTheDocument();
    });
  });
});
