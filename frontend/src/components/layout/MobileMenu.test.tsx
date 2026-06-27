import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { server } from "@/test/msw/server";
import { unauthMeHandler } from "@/test/msw/me";
import { NavMenu } from "@/components/layout/MobileMenu";

function renderMenu() {
  return render(
    <MemoryRouter>
      <NavMenu />
    </MemoryRouter>,
  );
}

describe("NavMenu", () => {
  it("exposes a labeled disclosure toggle", () => {
    server.use(unauthMeHandler());
    renderMenu();
    expect(screen.getByLabelText(/open menu/i)).toBeInTheDocument();
  });

  it("renders the collapsed nav links (Updates + Calendar) under the mobile nav landmark", () => {
    server.use(unauthMeHandler());
    renderMenu();
    const nav = screen.getByRole("navigation", { name: /mobile navigation/i });
    expect(within(nav).getByRole("link", { name: /^updates$/i })).toHaveAttribute("href", "/");
    expect(within(nav).getByRole("link", { name: /^calendar$/i })).toHaveAttribute(
      "href",
      "/calendar",
    );
    expect(within(nav).queryByRole("link", { name: /^browse$/i })).toBeNull();
    expect(within(nav).queryByRole("link", { name: /^search$/i })).toBeNull();
  });

  it("shows no Log in link when logged out (no public login until a paid tier)", () => {
    server.use(unauthMeHandler());
    renderMenu();
    expect(screen.queryByRole("link", { name: /log in/i })).toBeNull();
  });
});
