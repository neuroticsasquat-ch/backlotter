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

  it("composes the primary navigation", () => {
    server.use(unauthMeHandler());
    renderHeader();
    const primaryNav = screen.getByRole("navigation", { name: /primary navigation/i });
    expect(within(primaryNav).getByRole("link", { name: /^home$/i })).toBeInTheDocument();
  });

  it("mounts the account island (logged-out by default)", async () => {
    server.use(unauthMeHandler());
    renderHeader();
    expect(await screen.findByRole("link", { name: /log in/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign up/i })).toBeInTheDocument();
  });
});
