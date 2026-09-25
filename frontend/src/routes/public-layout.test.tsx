import { render, screen, waitFor, within } from "@testing-library/react";
import { createRoutesStub, MemoryRouter, Route, Routes } from "react-router";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { WORDMARK } from "@/components/layout/nav-items";
import { server } from "@/test/msw/server";
import { unauthMeHandler } from "@/test/msw/me";
import { env } from "@/env";
import type { AuthedUser } from "@/api/types";
import { readTimelineHint, writeTimelineHint } from "@/lib/timeline-hint";
import PublicLayout, { loader, publicQueryClient } from "@/routes/public-layout";
import { useAuth } from "@/components/AuthContext";

/** Calls useAuth() to verify AuthProvider is in the tree above it. */
function AuthProbe() {
  useAuth();
  return <p>probe ok</p>;
}

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

    // 2. Inline primary nav: Updates (home) + Calendar (Search is the box, Browse is gone)
    const primaryNav = screen.getByRole("navigation", { name: /primary navigation/i });
    expect(within(primaryNav).getByRole("link", { name: /^updates$/i })).toHaveAttribute(
      "href",
      "/",
    );
    expect(within(primaryNav).getByRole("link", { name: /^calendar$/i })).toHaveAttribute(
      "href",
      "/calendar",
    );
    expect(within(primaryNav).queryByRole("link", { name: /^browse$/i })).toBeNull();
    expect(within(primaryNav).queryByRole("link", { name: /^search$/i })).toBeNull();

    // 4. Search box renders in its own bar (below the header, not inside it)
    expect(screen.getByRole("search", { name: /^search$/i })).toBeInTheDocument();

    // 5. Footer — wordmark text in copyright line
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText(new RegExp(WORDMARK, "i"))).toBeInTheDocument();

    // 6. Routed child renders
    expect(screen.getByText("page body")).toBeInTheDocument();
  });
});

it("provides Auth + Query context to routed page content", async () => {
  const Stub = createRoutesStub([
    { Component: PublicLayout, children: [{ index: true, Component: AuthProbe }] },
  ]);
  render(<Stub />);
  expect(await screen.findByText("probe ok")).toBeInTheDocument();
});

/** The server's only look at the timeline hint (NEU-1468, D-1468.3). */
describe("PublicLayout loader", () => {
  const callLoader = (headers: Record<string, string> = {}) =>
    loader({
      request: new Request("https://backlotter.example/", { headers }),
    } as unknown as Parameters<typeof loader>[0]);

  it("reports the hint when the request's Cookie header carries it", () => {
    expect(callLoader({ Cookie: "session=abc; timeline_hint=1" })).toEqual({ timelineHint: true });
  });

  it("reports no hint otherwise", () => {
    expect(callLoader({ Cookie: "session=abc" })).toEqual({ timelineHint: false });
    expect(callLoader()).toEqual({ timelineHint: false });
  });

  it("makes no fetch", () => {
    // Every request is unhandled-is-an-error under MSW; one that must never happen at all is
    // pinned harder with a handler that throws.
    server.use(
      http.all("*", () => {
        throw new Error("the layout loader must not fetch");
      }),
    );
    callLoader({ Cookie: "timeline_hint=1" });
  });
});

describe("PublicLayout — the nav under the timeline hint", () => {
  beforeEach(() => publicQueryClient.clear());

  const slow401 = () =>
    http.get(`${env.apiBaseUrl}/me`, async () => {
      await delay(100);
      return HttpResponse.json({ detail: "auth_required" }, { status: 401 });
    });

  function renderLayout(timelineHint: boolean) {
    const Stub = createRoutesStub([
      {
        Component: PublicLayout,
        loader: () => ({ timelineHint }),
        children: [{ index: true, Component: () => <p>page body</p> }],
      },
    ]);
    render(<Stub />);
  }

  const primaryNav = () => screen.getByRole("navigation", { name: /primary navigation/i });

  it("names both feeds under the hint while /me is in flight, then collapses on 401", async () => {
    // Loader and jar agree, as they do in life; which one is read when is pinned below and in
    // public-layout.ssr.test.tsx.
    writeTimelineHint({ entitled: true } as AuthedUser);
    server.use(slow401());
    renderLayout(true);

    await screen.findByText("page body");
    expect(within(primaryNav()).getByRole("link", { name: /^my feed$/i })).toBeInTheDocument();
    expect(within(primaryNav()).getByRole("link", { name: /^all updates$/i })).toBeInTheDocument();

    expect(
      await within(primaryNav()).findByRole("link", { name: /^updates$/i }),
    ).toBeInTheDocument();
    expect(within(primaryNav()).queryByRole("link", { name: /^my feed$/i })).toBeNull();
  });

  it("does not bring back a hint the account has cleared since the loader ran", async () => {
    // The loader said yes, `/me` then answered 401 and cleared the cookie. A later re-read of the
    // account (a reconnect, a `refresh()`) must stay anonymous, not flash the two-item nav from
    // the loader's stale snapshot (D-1468.4).
    writeTimelineHint({ entitled: true } as AuthedUser);
    server.use(slow401());
    renderLayout(true);

    await screen.findByText("page body");
    expect(
      await within(primaryNav()).findByRole("link", { name: /^updates$/i }),
    ).toBeInTheDocument();
    expect(readTimelineHint(document.cookie)).toBe(false);

    const refetch = publicQueryClient.refetchQueries({ queryKey: ["me"] });
    await waitFor(() => expect(publicQueryClient.isFetching({ queryKey: ["me"] })).toBe(1));
    expect(within(primaryNav()).queryByRole("link", { name: /^my feed$/i })).toBeNull();
    await refetch;
  });
});
