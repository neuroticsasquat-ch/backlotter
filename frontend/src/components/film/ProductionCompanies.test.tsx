import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoutesStub } from "react-router";
import { AuthProvider } from "@/components/AuthContext";
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

  describe("follow buttons", () => {
    function renderWithProviders(ui: React.ReactElement) {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const Stub = createRoutesStub([{ path: "/", Component: () => ui }]);
      return render(
        <QueryClientProvider client={qc}>
          <AuthProvider>
            <Stub initialEntries={["/"]} />
          </AuthProvider>
        </QueryClientProvider>,
      );
    }

    it("offers one per company the payload identifies", async () => {
      renderWithProviders(
        <ProductionCompanies companies={[{ id: 33, name: "Universal Pictures" }]} />,
      );
      expect(
        await screen.findByRole("link", { name: /sign in to follow universal pictures/i }),
      ).toBeInTheDocument();
    });

    it("renders a company with no id as a name alone", () => {
      // No id, no follow button — the list still reads the same as before.
      const { container } = render(
        <ProductionCompanies companies={[{ name: "Universal Pictures" }]} />,
      );
      expect(container.querySelector("li")?.textContent).toBe("Universal Pictures");
    });

    it("links an identified company to its studio page", () => {
      renderWithProviders(
        <ProductionCompanies companies={[{ id: 33, name: "Universal Pictures" }]} />,
      );
      expect(screen.getByRole("link", { name: "Universal Pictures" })).toHaveAttribute(
        "href",
        "/studio/33-universal-pictures",
      );
    });

    it("leaves a company the payload cannot identify unlinked", () => {
      // The same branch as the missing follow button: a link here would point at
      // `/studio/undefined`.
      renderWithProviders(<ProductionCompanies companies={[{ name: "Universal Pictures" }]} />);
      expect(screen.queryByRole("link", { name: "Universal Pictures" })).not.toBeInTheDocument();
      expect(screen.getByText("Universal Pictures")).toBeInTheDocument();
    });
  });
});
