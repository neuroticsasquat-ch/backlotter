import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductionCompanies } from "@/components/film/ProductionCompanies";

describe("ProductionCompanies", () => {
  it("renders the heading with a count", () => {
    render(<ProductionCompanies companies={["Universal Pictures", "Blumhouse"]} />);
    expect(screen.getByRole("heading", { name: "Companies" })).toBeInTheDocument();
    expect(screen.getByText("(2)")).toBeInTheDocument();
  });

  it("is collapsed by default", () => {
    const { container } = render(<ProductionCompanies companies={["Universal Pictures"]} />);
    expect(container.querySelector("details")).not.toHaveAttribute("open");
  });

  it("renders one company per line", () => {
    const { container } = render(
      <ProductionCompanies companies={["Universal Pictures", "Blumhouse"]} />,
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
});
