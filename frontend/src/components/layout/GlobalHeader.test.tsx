import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/components/AuthContext";
import { WORDMARK } from "@/components/layout/nav-items";
import { server } from "@/test/msw/server";
import { meHandler, unauthMeHandler } from "@/test/msw/me";
import { GlobalHeader } from "@/components/layout/GlobalHeader";

/** The providers `PublicLayout` supplies in the app. `PrimaryNav` needs them now that the
 *  nav depends on whether the reader has a timeline (NEU-1407). */
function renderHeader() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter>
          <GlobalHeader />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const primaryNav = () => screen.getByRole("navigation", { name: /primary navigation/i });

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

  describe("the primary nav", () => {
    /**
     * `/` renders the global feed for a reader with no timeline, which is exactly what
     * `/feed` renders — two names for one destination. Only one survives.
     */
    it("names one updates destination for an anonymous visitor", () => {
      server.use(unauthMeHandler());
      renderHeader();

      const nav = primaryNav();
      expect(within(nav).getByRole("link", { name: /^updates$/i })).toHaveAttribute("href", "/");
      expect(within(nav).getByRole("link", { name: /^calendar$/i })).toHaveAttribute(
        "href",
        "/calendar",
      );
      expect(within(nav).queryByRole("link", { name: /^all updates$/i })).toBeNull();
      expect(within(nav).queryByRole("link", { name: /^my feed$/i })).toBeNull();
      expect(within(nav).queryByRole("link", { name: /^browse$/i })).toBeNull();
      expect(within(nav).queryByRole("link", { name: /^search$/i })).toBeNull();
    });

    it("names both, and says which is which, for an entitled account", async () => {
      server.use(meHandler({ entitled: true }));
      renderHeader();

      const myFeed = await within(primaryNav()).findByRole("link", { name: /^my feed$/i });
      expect(myFeed).toHaveAttribute("href", "/");
      expect(within(primaryNav()).getByRole("link", { name: /^all updates$/i })).toHaveAttribute(
        "href",
        "/feed",
      );
    });

    it("collapses them for a signed-in account without a grant", async () => {
      server.use(meHandler({ entitled: false }));
      renderHeader();

      // Keyed off the account menu, which only appears once `/me` has resolved — so this is
      // the locked state and not merely the pre-auth render.
      await screen.findByRole("button", { name: /account menu/i });
      expect(within(primaryNav()).getByRole("link", { name: /^updates$/i })).toBeInTheDocument();
      expect(within(primaryNav()).queryByRole("link", { name: /^all updates$/i })).toBeNull();
    });
  });

  it("gives an anonymous visitor an account menu with a way in", async () => {
    server.use(unauthMeHandler());
    renderHeader();

    expect(await screen.findByRole("button", { name: /^account menu$/i })).toBeInTheDocument();
  });
});
