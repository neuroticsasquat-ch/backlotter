import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { WORDMARK } from "@/components/layout/nav-items";
import { server } from "@/test/msw/server";
import { unauthMeHandler } from "@/test/msw/me";
import PublicLayout from "@/routes/public-layout";

describe("PublicLayout", () => {
  it("renders the full chrome and routed child", async () => {
    server.use(unauthMeHandler());

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route index element={<p>page body</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    // 1. Wordmark link to /
    const wordmarkLink = screen.getByRole("link", { name: new RegExp(WORDMARK, "i") });
    expect(wordmarkLink).toHaveAttribute("href", "/");

    // 2. Enabled nav links — scoped to the primary nav to avoid footer duplicates
    const primaryNav = screen.getByRole("navigation", { name: /primary navigation/i });
    expect(within(primaryNav).getByRole("link", { name: /^home$/i })).toBeInTheDocument();
    expect(within(primaryNav).getByRole("link", { name: /^browse$/i })).toHaveAttribute(
      "href",
      "/browse",
    );
    expect(within(primaryNav).getByRole("link", { name: /^search$/i })).toHaveAttribute(
      "href",
      "/search",
    );

    // 3. Calendar is now a live link
    expect(within(primaryNav).getByRole("link", { name: /^calendar$/i })).toHaveAttribute(
      "href",
      "/calendar",
    );

    // 4. Footer — wordmark text in copyright line
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText(new RegExp(WORDMARK, "i"))).toBeInTheDocument();

    // 5. Routed child renders
    expect(screen.getByText("page body")).toBeInTheDocument();
  });
});
