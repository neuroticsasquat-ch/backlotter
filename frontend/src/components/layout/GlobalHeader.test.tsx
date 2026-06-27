import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { WORDMARK } from "@/components/layout/nav-items";
import { server } from "@/test/msw/server";
import { unauthMeHandler } from "@/test/msw/me";
import { GlobalHeader } from "@/components/layout/GlobalHeader";

function renderHeader() {
  return render(
    <MemoryRouter>
      <GlobalHeader />
    </MemoryRouter>,
  );
}

describe("GlobalHeader", () => {
  it("renders the wordmark linking to the feed root", () => {
    server.use(unauthMeHandler());
    renderHeader();
    const banner = screen.getByRole("banner");
    const wordmark = within(banner).getByRole("link", { name: new RegExp(WORDMARK, "i") });
    expect(wordmark).toHaveAttribute("href", "/");
  });

  it("does not render the search box (it lives in its own bar below the header)", () => {
    server.use(unauthMeHandler());
    renderHeader();
    expect(screen.queryByRole("search")).toBeNull();
  });

  it("renders Updates + Calendar in the inline primary navigation (no Browse/Search)", () => {
    server.use(unauthMeHandler());
    renderHeader();
    const nav = screen.getByRole("navigation", { name: /primary navigation/i });
    expect(within(nav).getByRole("link", { name: /^updates$/i })).toHaveAttribute("href", "/");
    expect(within(nav).getByRole("link", { name: /^calendar$/i })).toHaveAttribute(
      "href",
      "/calendar",
    );
    expect(within(nav).queryByRole("link", { name: /^browse$/i })).toBeNull();
    expect(within(nav).queryByRole("link", { name: /^search$/i })).toBeNull();
  });

  it("shows no account links when logged out (no public Log in / Sign up)", () => {
    server.use(unauthMeHandler());
    renderHeader();
    expect(screen.queryByRole("link", { name: /log in/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /sign up/i })).toBeNull();
  });
});
