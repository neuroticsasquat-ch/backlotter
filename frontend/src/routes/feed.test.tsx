import { RouterContextProvider, createRoutesStub } from "react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { env } from "@/env";
import { meHandler, unauthMeHandler } from "@/test/msw/me";
import { emptyTimelineHandler, lockedTimelineHandler, timelineHandler } from "@/test/msw/timeline";
import { dayItem, feed } from "@/test/feed-fixtures";
import { cloudflareContext, type AppEnv } from "@/lib/load-context";
import { AuthProvider, useAuth } from "@/components/AuthContext";
import { useToggleFollow } from "@/api/me";
import FeedPage, { loader, meta } from "@/routes/feed";
import { TimelineOrFeed } from "@/components/feed/TimelineOrFeed";

const BACKEND = "https://api.upmovies.localhost";

/** Overrides for one `callLoader` call: Worker env extras and inbound request headers. */
type LoaderCall = { env?: Partial<AppEnv>; headers?: Record<string, string> };

function contextWithEnv(env: Partial<AppEnv> = {}) {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, { env: { API_BASE_URL: BACKEND, ...env } });
  return context;
}

function callLoader({ env, headers }: LoaderCall = {}) {
  return loader({
    request: new Request("https://upmovies.example/", { headers }),
    context: contextWithEnv(env),
    params: {},
  } as unknown as Parameters<typeof loader>[0]);
}

describe("feed route loader", () => {
  it("signs the fetch and forwards the visitor IP when the secret is set", async () => {
    let captured: Headers | undefined;
    server.use(
      http.get(`${BACKEND}/feed/grouped`, ({ request }) => {
        captured = request.headers;
        return HttpResponse.json(feed);
      }),
    );
    await callLoader({
      env: { SSR_ORIGIN_SECRET: "s3cret" },
      headers: { "CF-Connecting-IP": "203.0.113.7" },
    });
    expect(captured?.get("X-Backlotter-Origin")).toBe("s3cret");
    expect(captured?.get("X-Backlotter-Client-IP")).toBe("203.0.113.7");
  });

  it("sends no signing headers when the secret is unset", async () => {
    let captured: Headers | undefined;
    server.use(
      http.get(`${BACKEND}/feed/grouped`, ({ request }) => {
        captured = request.headers;
        return HttpResponse.json(feed);
      }),
    );
    await callLoader({ headers: { "CF-Connecting-IP": "203.0.113.7" } });
    expect(captured?.get("X-Backlotter-Origin")).toBeNull();
    expect(captured?.get("X-Backlotter-Client-IP")).toBeNull();
  });

  it("fetches the grouped feed from the backend", async () => {
    server.use(http.get(`${BACKEND}/feed/grouped`, () => HttpResponse.json(feed)));
    const data = await callLoader();
    expect(data.feed.total).toBe(2);
    expect(data.feed.items[0].film_ref).toBe("the-odyssey-2026");
  });

  it("SSRs the global feed whatever the session is, so / stays anonymous-safe", async () => {
    // The loader never reads a cookie and never calls /me: the swap to a timeline is a client
    // decision (D-12), which is what keeps this document cacheable and free of a hydration
    // mismatch. A request carrying a session must produce the same fetch as one without.
    const paths: string[] = [];
    server.use(
      http.get(`${BACKEND}/feed/grouped`, ({ request }) => {
        paths.push(new URL(request.url).pathname);
        return HttpResponse.json(feed);
      }),
      http.get(`${BACKEND}/me`, () => {
        throw new Error("the / loader must not resolve auth server-side");
      }),
    );
    await callLoader({ headers: { Cookie: "session=abc" } });
    expect(paths).toEqual(["/feed/grouped"]);
  });
});

describe("feed route meta", () => {
  it("builds the landing head with the brand-lockup title and canonical link", () => {
    const tags = meta({
      location: { pathname: "/" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags).toContainEqual({ title: "production log — backlotter" });
    expect(tags.some((t) => "name" in t && t.name === "description")).toBe(true);
    expect(tags.some((t) => "tagName" in t && t.tagName === "link" && t.rel === "canonical")).toBe(
      true,
    );
  });
});

/** The home route with the providers the public layout gives it, so the island can resolve
 *  `me` the way it does in the app. */
function renderHome(loaderFeed = feed) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Stub = createRoutesStub([
    { path: "/", Component: FeedPage, loader: () => ({ feed: loaderFeed }) },
    { path: "/feed", Component: () => <h1>All updates</h1> },
    { path: "/calendar", Component: () => <h1>Calendar</h1> },
    { path: "/login", Component: () => <h1>Log in</h1> },
  ]);
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Stub initialEntries={["/"]} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const GLOBAL_HEADING = "All updates";
const timelineHeading = () => screen.findByRole("heading", { name: "My feed" });

describe("home route — anonymous", () => {
  it("renders the SSR'd global feed, named the way the nav names it", async () => {
    server.use(unauthMeHandler());
    renderHome();

    expect(await screen.findByRole("heading", { name: GLOBAL_HEADING })).toBeInTheDocument();
    // The feed itself is the one the loader already fetched.
    expect(screen.getByText(/June 23, 2026/)).toBeInTheDocument();
  });

  /** The only way to `/login` is the header's account menu now (NEU-1407/1410). */
  it("offers no sign-in link of its own", async () => {
    server.use(unauthMeHandler());
    renderHome();

    await screen.findByRole("heading", { name: GLOBAL_HEADING });
    expect(screen.queryByRole("link", { name: /^sign in$/i })).toBeNull();
    expect(screen.queryByText(/see a timeline of the people you follow/i)).toBeNull();
  });

  /** The words the old SEO heading carried, kept as body copy on the same document. */
  it("carries the descriptive standfirst under the heading", async () => {
    server.use(unauthMeHandler());
    renderHome();

    expect(
      await screen.findByText(/every casting change, trailer and release date/i),
    ).toBeInTheDocument();
  });

  it("shows no loading state while /me is still in flight", async () => {
    // Held open so "still in flight" is a real window to assert inside rather than a race.
    server.use(
      http.get(`${env.apiBaseUrl}/me`, async () => {
        await delay(100);
        return HttpResponse.json({ detail: "auth_required" }, { status: 401 });
      }),
    );
    renderHome();

    // The whole feed is up before the account query lands — the anonymous experience must not
    // regress into a spinner while we work out whether there is anyone to swap it for.
    expect(await screen.findByRole("heading", { name: GLOBAL_HEADING })).toBeInTheDocument();
    expect(screen.getByText(/June 23, 2026/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/loading your timeline/i)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("never requests the timeline", async () => {
    let asked = false;
    server.use(
      unauthMeHandler(),
      http.get(`${env.apiBaseUrl}/me/timeline`, () => {
        asked = true;
        return HttpResponse.json({ items: [], total: 0, limit: 10, offset: 0 });
      }),
    );
    renderHome();
    await screen.findByRole("heading", { name: GLOBAL_HEADING });
    expect(asked).toBe(false);
  });
});

describe("home route — signed in without a grant", () => {
  /**
   * The point of NEU-1410: this reader gets the same page an anonymous one gets, and the same
   * page `/feed` gives them. The "Your timeline is not open yet" panel that used to sit here
   * is gone — its copy said there was nothing to buy, and NEU-1409 replaces it with the real
   * subscription offer, shown on both routes rather than only this one.
   */
  it("renders the global feed with nothing added and nothing withheld", async () => {
    server.use(meHandler({ entitled: false }), lockedTimelineHandler());
    renderHome();

    expect(await screen.findByRole("heading", { name: GLOBAL_HEADING })).toBeInTheDocument();
    expect(screen.getByText(/June 23, 2026/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /not open yet/i })).toBeNull();
    expect(screen.queryByText(/access is limited while we build that tier/i)).toBeNull();
  });

  it("offers no sign-in link either — they are already signed in", async () => {
    server.use(meHandler({ entitled: false }), lockedTimelineHandler());
    renderHome();

    await screen.findByRole("heading", { name: GLOBAL_HEADING });
    expect(screen.queryByRole("link", { name: /^sign in$/i })).toBeNull();
  });

  it("does not offer the onboarding the empty timeline offers", async () => {
    // "No access yet" and "no follows yet" are different states: sending this reader to follow
    // something would only get them refused (D-41).
    server.use(meHandler({ entitled: false }), lockedTimelineHandler());
    renderHome();

    await screen.findByRole("heading", { name: GLOBAL_HEADING });
    expect(screen.queryByText(/your timeline is empty/i)).toBeNull();
    expect(screen.queryByRole("link", { name: /get started/i })).toBeNull();
  });

  it("never requests the timeline it is not entitled to", async () => {
    let asked = false;
    server.use(
      meHandler({ entitled: false }),
      http.get(`${env.apiBaseUrl}/me/timeline`, () => {
        asked = true;
        return HttpResponse.json({ detail: "entitlement_required" }, { status: 403 });
      }),
    );
    renderHome();
    await screen.findByRole("heading", { name: GLOBAL_HEADING });
    expect(asked).toBe(false);
  });
});

describe("home route — signed in and entitled", () => {
  it("swaps the global feed for the timeline", async () => {
    server.use(
      meHandler({ entitled: true }),
      timelineHandler([
        dayItem("followed-film", { film_title: "Followed Film", news_backed: true }),
      ]),
    );
    renderHome();

    // Keyed off a day from the timeline, not the heading: the heading is up during the skeleton
    // too (by design — the page must not jump), and the node holding it is replaced when the
    // days land, so awaiting it hands back an element that is already detached.
    expect(await screen.findByText("Followed Film")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "My feed" })).toBeInTheDocument();
    // The global feed is gone — its heading and its days with it.
    expect(screen.queryByRole("heading", { name: GLOBAL_HEADING })).toBeNull();
    expect(screen.queryByText("The Odyssey")).toBeNull();
  });

  it("links out to the unfiltered feed", async () => {
    server.use(meHandler({ entitled: true }), timelineHandler([dayItem("followed-film")]));
    renderHome();

    await timelineHeading();
    expect(screen.getByRole("link", { name: /all updates/i })).toHaveAttribute("href", "/feed");
  });

  it("renders the onboarding card when nothing is followed yet", async () => {
    server.use(meHandler({ entitled: true }), emptyTimelineHandler());
    renderHome();

    await timelineHeading();
    expect(await screen.findByText(/your timeline is empty/i)).toBeInTheDocument();
    // `/welcome` now that NEU-1358 has built it — the card used to point one hop wide, at the
    // calendar, because the onboarding route did not exist yet.
    expect(screen.getByRole("link", { name: /get started/i })).toHaveAttribute("href", "/welcome");
    expect(screen.getByRole("link", { name: /browse all updates/i })).toHaveAttribute(
      "href",
      "/feed",
    );
    // An empty timeline is never an empty page, and never the locked panel.
    expect(screen.queryByRole("heading", { name: /not open yet/i })).toBeNull();
  });

  it("fetches the next page of days when there are more than fit on one", async () => {
    const days = Array.from({ length: 12 }, (_, n) =>
      // News-backed so the day's expanded section carries them: the unconfirmed half is
      // collapsed by default, and a test asserting on paging should not also be asserting on
      // which disclosure the item landed in.
      dayItem(`film-${n}`, {
        day: `2026-06-${String(23 - n).padStart(2, "0")}`,
        film_title: `Film ${n}`,
        news_backed: true,
      }),
    );
    server.use(meHandler({ entitled: true }), timelineHandler(days, 12));
    renderHome();

    await timelineHeading();
    // Two round trips and twelve days of markup behind them, so the default 1s is tight.
    expect(await screen.findByText("Film 0", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText("Film 10")).toBeNull();

    await userEvent.click(await screen.findByRole("button", { name: /view more/i }));
    expect(await screen.findByText("Film 10", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("Film 11")).toBeInTheDocument();
  });

  it("shows a skeleton in the content area until the first page lands", async () => {
    server.use(
      meHandler({ entitled: true }),
      http.get(`${env.apiBaseUrl}/me/timeline`, async () => {
        // Held open so the skeleton is observable rather than a race the assertion may lose.
        await delay(50);
        return HttpResponse.json({ items: [], total: 0, limit: 10, offset: 0 });
      }),
    );
    renderHome();

    // The heading is already up while the days load, so the page does not jump when they land.
    expect(await screen.findByLabelText(/loading your timeline/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "My feed" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByLabelText(/loading your timeline/i)).toBeNull());
  });
});

/** A control the real page does not carry — the account menu lives in the header, outside this
 *  route — so the cache behaviour around signing out can be driven from within the page under
 *  test rather than by reaching into the QueryClient. */
function LogOutControl() {
  const { logout } = useAuth();
  return (
    <button type="button" onClick={() => void logout()}>
      Log out
    </button>
  );
}

/** Likewise for a follow: the buttons live on film pages, but what a follow does to *this*
 *  page's cache is this page's business. */
function FollowControl() {
  const toggle = useToggleFollow();
  return (
    <button
      type="button"
      onClick={() =>
        toggle.mutate({
          target: { entityType: "person", entityId: "505710", label: "Zendaya" },
          following: false,
        })
      }
    >
      Follow someone
    </button>
  );
}

function renderHomeWith(extra: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Stub = createRoutesStub([
    {
      path: "/",
      loader: () => ({ feed }),
      // The island rather than the route module: what these two assert is cache behaviour
      // around the swap, and the route adds only a loader the stub is already standing in for.
      Component: () => (
        <>
          <TimelineOrFeed feed={feed} />
          {extra}
        </>
      ),
    },
    { path: "/feed", Component: () => <h1>All updates</h1> },
    { path: "/calendar", Component: () => <h1>Calendar</h1> },
    { path: "/login", Component: () => <h1>Log in</h1> },
  ]);
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Stub initialEntries={["/"]} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("home route — the timeline could not be read", () => {
  it("says so rather than showing the onboarding card", async () => {
    // An error is not `total === 0`. Falling through to the empty state would tell an entitled
    // reader to go and follow things they may already follow.
    server.use(
      meHandler({ entitled: true }),
      http.get(`${env.apiBaseUrl}/me/timeline`, () =>
        HttpResponse.json({ detail: "server_error" }, { status: 500 }),
      ),
    );
    renderHome();

    expect(await screen.findByText(/couldn't load your timeline/i)).toBeInTheDocument();
    expect(screen.queryByText(/your timeline is empty/i)).toBeNull();
    expect(screen.getByRole("link", { name: /browse all updates/i })).toHaveAttribute(
      "href",
      "/feed",
    );
  });

  it("falls back to the global feed when the grant lapsed mid-session", async () => {
    // The cached account still said `entitled`, so the timeline mounted and got a 403. Re-reading
    // /me flips the flag, and the island must land on the global feed — never on "no follows
    // yet", which would send a reader to follow something they would be refused.
    let meCalls = 0;
    server.use(
      http.get(`${env.apiBaseUrl}/me`, () => {
        meCalls += 1;
        return HttpResponse.json({
          id: "u1",
          email: "a@b.com",
          display_name: "Test User",
          is_admin: false,
          email_verified: true,
          // Entitled on the first read only: the grant runs out between the two.
          entitled: meCalls === 1,
          created_at: "2026-06-23T12:00:00Z",
          csrf_token: "test-csrf",
        });
      }),
      lockedTimelineHandler(),
    );
    renderHome();

    // The global feed the server already sent is what they are left looking at — no panel
    // above it, and not the empty-timeline onboarding.
    expect(await screen.findByRole("heading", { name: GLOBAL_HEADING })).toBeInTheDocument();
    expect(screen.queryByText(/your timeline is empty/i)).toBeNull();
    expect(screen.queryByText(/couldn't load your timeline/i)).toBeNull();
    expect(screen.queryByRole("heading", { name: /not open yet/i })).toBeNull();
  });
});

describe("home route — cache behaviour around the swap", () => {
  it("falls back to the SSR'd feed on logout, with no round trip for it", async () => {
    let feedFetches = 0;
    server.use(
      meHandler({ entitled: true }),
      timelineHandler([
        dayItem("followed-film", { film_title: "Followed Film", news_backed: true }),
      ]),
      http.post(`${env.apiBaseUrl}/auth/logout`, () => new HttpResponse(null, { status: 204 })),
      http.get(`${env.apiBaseUrl}/feed/grouped`, () => {
        feedFetches += 1;
        return HttpResponse.json(feed);
      }),
    );
    renderHomeWith(<LogOutControl />);

    await screen.findByText("Followed Film");
    await userEvent.click(screen.getByRole("button", { name: /log out/i }));

    // Back to the global feed the loader already handed us — the data never left `loaderData`,
    // so re-rendering it costs nothing.
    expect(await screen.findByRole("heading", { name: GLOBAL_HEADING })).toBeInTheDocument();
    expect(screen.getByText(/June 23, 2026/)).toBeInTheDocument();
    expect(feedFetches).toBe(0);
    // And the previous reader's timeline is gone, not merely stale.
    expect(screen.queryByText("Followed Film")).toBeNull();
  });

  it("refreshes the timeline when a follow lands", async () => {
    let timelineFetches = 0;
    server.use(
      meHandler({ entitled: true }),
      http.get(`${env.apiBaseUrl}/me/timeline`, () => {
        timelineFetches += 1;
        return HttpResponse.json({
          items: [dayItem("followed-film", { film_title: "Followed Film", news_backed: true })],
          total: 1,
          limit: 10,
          offset: 0,
        });
      }),
      http.post(`${env.apiBaseUrl}/me/follows`, () =>
        HttpResponse.json(
          {
            entity_type: "person",
            entity_id: "505710",
            source: "manual",
            created_at: "2026-06-23T12:00:00Z",
          },
          { status: 201 },
        ),
      ),
      http.get(`${env.apiBaseUrl}/me/follows`, () => HttpResponse.json({ items: [] })),
    );
    renderHomeWith(<FollowControl />);

    await screen.findByText("Followed Film");
    const before = timelineFetches;

    await userEvent.click(screen.getByRole("button", { name: /follow someone/i }));

    // The timeline is the feed filtered by exactly this list, so a new follow has to re-read it.
    await waitFor(() => expect(timelineFetches).toBeGreaterThan(before));
  });
});
