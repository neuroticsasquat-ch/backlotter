import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/components/AuthContext";
import { server } from "@/test/msw/server";
import { meHandler, unauthMeHandler } from "@/test/msw/me";
import { NavMenu } from "@/components/layout/MobileMenu";

/**
 * The providers `PublicLayout` supplies in the app. `NavMenu` needs them now that the nav it
 * renders depends on whether the reader has a timeline (NEU-1407).
 */
function renderMenu() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter>
          <NavMenu />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const mobileNav = () => screen.getByRole("navigation", { name: /mobile navigation/i });

describe("NavMenu", () => {
  it("exposes a labeled disclosure toggle", () => {
    server.use(unauthMeHandler());
    renderMenu();
    expect(screen.getByLabelText(/open menu/i)).toBeInTheDocument();
  });

  it("collapses the two feeds into one for a visitor with no timeline", () => {
    server.use(unauthMeHandler());
    renderMenu();

    const nav = mobileNav();
    expect(within(nav).getByRole("link", { name: /^updates$/i })).toHaveAttribute("href", "/");
    expect(within(nav).getByRole("link", { name: /^calendar$/i })).toHaveAttribute(
      "href",
      "/calendar",
    );
    // `/` and `/feed` render the same page for this reader, so only one is named.
    expect(within(nav).queryByRole("link", { name: /^all updates$/i })).toBeNull();
    expect(within(nav).queryByRole("link", { name: /^my feed$/i })).toBeNull();
  });

  it("names both feeds for an entitled account", async () => {
    server.use(meHandler({ entitled: true }));
    renderMenu();

    const myFeed = await screen.findByRole("link", { name: /^my feed$/i });
    expect(myFeed).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /^all updates$/i })).toHaveAttribute("href", "/feed");
    expect(screen.queryByRole("link", { name: /^updates$/i })).toBeNull();
  });

  /** Signed in without a grant sees the global feed on `/` exactly as an anonymous visitor
   *  does, so it gets the same single item — the predicate is access, not sign-in. */
  it("collapses them for a signed-in account without a grant too", async () => {
    server.use(meHandler({ entitled: false }));
    renderMenu();

    expect(await screen.findByRole("link", { name: /^updates$/i })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: /^all updates$/i })).toBeNull();
  });

  it("offers Log in when logged out", async () => {
    server.use(unauthMeHandler());
    renderMenu();

    const login = await screen.findByRole("link", { name: /log in/i });
    // `next` brings the reader back to where they were.
    expect(login.getAttribute("href")).toContain("/login?next=");
  });
});
