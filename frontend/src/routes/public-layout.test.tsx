import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import PublicLayout from "@/routes/public-layout";

describe("PublicLayout", () => {
  it("renders a brand wordmark linking to the feed root and the routed child", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route index element={<p>page body</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    const banner = screen.getByRole("banner");
    const brand = within(banner).getByRole("link", { name: /backlotter/i });
    expect(brand).toHaveAttribute("href", "/");
    expect(screen.getByText("page body")).toBeInTheDocument();

    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText(/©\s*\d{4}\s*BackLotter/)).toBeInTheDocument();
  });
});
