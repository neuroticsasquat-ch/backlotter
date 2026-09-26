import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/components/AuthContext";
import { server } from "@/test/msw/server";
import { meHandler, unauthMeHandler } from "@/test/msw/me";
import { NavMenu } from "@/components/layout/MobileMenu";
import { env } from "@/env";
import type { AuthedUser } from "@/api/types";
import { writeTimelineHint } from "@/lib/timeline-hint";

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

  describe("with the timeline hint (NEU-1468)", () => {
    const slow401 = () =>
      http.get(`${env.apiBaseUrl}/me`, async () => {
        await delay(100);
        return HttpResponse.json({ detail: "auth_required" }, { status: 401 });
      });

    it("names both feeds while /me is in flight, then collapses when it answers 401", async () => {
      writeTimelineHint({ entitled: true } as AuthedUser);
      server.use(slow401());
      renderMenu();

      const nav = mobileNav();
      expect(within(nav).getByRole("link", { name: /^my feed$/i })).toHaveAttribute("href", "/");
      expect(within(nav).getByRole("link", { name: /^all updates$/i })).toHaveAttribute(
        "href",
        "/feed",
      );

      expect(await within(nav).findByRole("link", { name: /^updates$/i })).toHaveAttribute(
        "href",
        "/",
      );
      expect(within(nav).queryByRole("link", { name: /^my feed$/i })).toBeNull();
    });

    it("lists Updates throughout without it", async () => {
      let answered = false;
      server.use(
        http.get(`${env.apiBaseUrl}/me`, async () => {
          await delay(100);
          answered = true;
          return HttpResponse.json({ detail: "auth_required" }, { status: 401 });
        }),
      );
      renderMenu();

      const nav = mobileNav();
      expect(within(nav).getByRole("link", { name: /^updates$/i })).toBeInTheDocument();
      await waitFor(() => expect(answered).toBe(true));
      expect(within(nav).getByRole("link", { name: /^updates$/i })).toBeInTheDocument();
      expect(within(nav).queryByRole("link", { name: /^my feed$/i })).toBeNull();
    });
  });

  it("offers Log in when logged out", async () => {
    server.use(unauthMeHandler());
    renderMenu();

    const login = await screen.findByRole("link", { name: /log in/i });
    // `next` brings the reader back to where they were.
    expect(login.getAttribute("href")).toContain("/login?next=");
  });
});
