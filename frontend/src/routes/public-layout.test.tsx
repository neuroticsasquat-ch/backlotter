import { render, screen } from "@testing-library/react";
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
    const brand = screen.getByRole("link", { name: /upcoming movies tracker/i });
    expect(brand).toHaveAttribute("href", "/");
    expect(screen.getByText("page body")).toBeInTheDocument();
  });
});
