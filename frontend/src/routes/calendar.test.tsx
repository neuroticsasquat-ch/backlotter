import { RouterContextProvider, createRoutesStub } from "react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { unauthMeHandler } from "@/test/msw/me";
import { cloudflareContext, type AppEnv } from "@/lib/load-context";
import { AuthProvider } from "@/components/AuthContext";
import CalendarPage, { loader, meta, shouldRevalidate, ErrorBoundary } from "@/routes/calendar";
import type { CalendarResponse } from "@/api/types";
import type { CalendarKind } from "@/lib/calendar";

const BACKEND = "https://api.upmovies.localhost";

/** Overrides for one `callLoader` call: Worker env extras, inbound request headers, and the
 *  route's splat — the calendar address after `/calendar/`. */
type LoaderCall = { env?: Partial<AppEnv>; headers?: Record<string, string>; splat?: string };

const calendarTwoDates: CalendarResponse = {
  items: [
    {
      film_ref: "the-odyssey-2026",
      film_title: "The Odyssey",
      release_year: 2026,
      poster_path: "/odyssey.jpg",
      release_date: "2026-07-04",
      release_type: "wide",
      director: null,
      stars: [],
      genres: [],
    },
    {
      film_ref: "dune-3-2026",
      film_title: "Dune Part Three",
      release_year: 2026,
      poster_path: null,
      release_date: "2026-07-04",
      release_type: "limited",
      director: null,
      stars: [],
      genres: [],
    },
    {
      film_ref: "avatar-3-2026",
      film_title: "Avatar 3",
      release_year: 2025,
      poster_path: "/avatar3.jpg",
      release_date: "2026-07-11",
      release_type: "wide",
      director: null,
      stars: [],
      genres: [],
    },
  ],
  total: 2, // two distinct dates (pagination counts dates, not film rows)
  limit: 20,
  offset: 0,
};

/** One date carrying both theatrical buckets, in the order the backend returns them: wide, then
 *  limited. The page groups by adjacency, so the fixture's order is the rendered order. */
const calendarWideAndLimited: CalendarResponse = {
  items: [
    {
      film_ref: "the-odyssey-2026",
      film_title: "The Odyssey",
      release_year: 2026,
      poster_path: null,
      release_date: "2026-07-04",
      release_type: "wide",
      director: null,
      stars: [],
      genres: [],
    },
    {
      film_ref: "dune-3-2026",
      film_title: "Dune Part Three",
      release_year: 2026,
      poster_path: null,
      release_date: "2026-07-04",
      release_type: "limited",
      director: null,
      stars: [],
      genres: [],
    },
  ],
  total: 1,
  limit: 20,
  offset: 0,
};

function contextWithEnv(env: Partial<AppEnv> = {}) {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, { env: { API_BASE_URL: BACKEND, ...env } });
  return context;
}

function callLoader({ env, headers, splat = "" }: LoaderCall = {}) {
  const path = splat ? `/calendar/${splat}` : "/calendar";
  return loader({
    request: new Request(`https://upmovies.example${path}`, { headers }),
    context: contextWithEnv(env),
    params: { "*": splat },
  } as unknown as Parameters<typeof loader>[0]);
}

describe("calendar route loader", () => {
  it("signs the fetch and forwards the visitor IP when the secret is set", async () => {
    let captured: Headers | undefined;
    server.use(
      http.get(`${BACKEND}/calendar`, ({ request }) => {
        captured = request.headers;
        return HttpResponse.json(calendarTwoDates);
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
      http.get(`${BACKEND}/calendar`, ({ request }) => {
        captured = request.headers;
        return HttpResponse.json(calendarTwoDates);
      }),
    );
    await callLoader({ headers: { "CF-Connecting-IP": "203.0.113.7" } });
    expect(captured?.get("X-Backlotter-Origin")).toBeNull();
    expect(captured?.get("X-Backlotter-Client-IP")).toBeNull();
  });

  it("fetches the In theaters calendar from the backend", async () => {
    let captured: URL | undefined;
    server.use(
      http.get(`${BACKEND}/calendar`, ({ request }) => {
        captured = new URL(request.url);
        return HttpResponse.json(calendarTwoDates);
      }),
    );
    const data = await callLoader();
    // The document is the theatrical calendar; At home is a browser fetch (D-1542.3).
    expect(captured?.searchParams.get("kind")).toBe("theatrical");
    expect(data.calendar.total).toBe(2);
    expect(data.calendar.items[0].film_ref).toBe("the-odyssey-2026");
    expect(data.kind).toBe("theatrical");
  });

  // Each address's document is its all-releases calendar of that kind; a My films address
  // renders its public twin's, since the server never resolves auth (NEU-1544).
  it.each([
    ["", "theatrical"],
    ["at-home", "home"],
    ["my-films", "theatrical"],
    ["my-films/at-home", "home"],
  ] as const)("fetches the kind the address %j names", async (splat, kind) => {
    let captured: URL | undefined;
    server.use(
      http.get(`${BACKEND}/calendar`, ({ request }) => {
        captured = new URL(request.url);
        return HttpResponse.json(calendarTwoDates);
      }),
    );
    const data = await callLoader({ splat });
    expect(captured?.searchParams.get("kind")).toBe(kind);
    expect(data.kind).toBe(kind);
  });

  it("throws a 404 for anything that is not a calendar address, without asking the backend", async () => {
    let asked = false;
    server.use(
      http.get(`${BACKEND}/calendar`, () => {
        asked = true;
        return HttpResponse.json(calendarTwoDates);
      }),
    );
    const thrown = await callLoader({ splat: "nope" }).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(404);
    expect(asked).toBe(false);
  });
});

describe("calendar route shouldRevalidate", () => {
  const args = (from: string, to: string) =>
    ({
      currentUrl: new URL(`https://upmovies.example${from}`),
      nextUrl: new URL(`https://upmovies.example${to}`),
      defaultShouldRevalidate: true,
    }) as unknown as Parameters<typeof shouldRevalidate>[0];

  it("skips the loader between two calendar addresses", () => {
    expect(shouldRevalidate(args("/calendar", "/calendar/at-home"))).toBe(false);
    expect(shouldRevalidate(args("/calendar/my-films/at-home", "/calendar/my-films"))).toBe(false);
  });

  it("defers to the default from anywhere else", () => {
    expect(shouldRevalidate(args("/film/x", "/calendar/at-home"))).toBe(true);
    expect(shouldRevalidate(args("/calendar/nope", "/calendar"))).toBe(true);
    // Defers, rather than answering true: the default's own `false` comes straight back.
    expect(
      shouldRevalidate({
        ...args("/film/x", "/calendar"),
        defaultShouldRevalidate: false,
      }),
    ).toBe(false);
  });
});

const metaAt = (pathname: string) =>
  meta({
    location: { pathname },
    params: { "*": pathname.replace(/^\/calendar\/?/, "") },
  } as unknown as Parameters<typeof meta>[0]);

const titleOf = (tags: ReturnType<typeof meta>) =>
  String((tags.find((t) => "title" in t) as { title: string }).title);
const descriptionOf = (tags: ReturnType<typeof meta>) =>
  (tags.find((t) => "name" in t && t.name === "description") as { content: string }).content;
const canonicalOf = (tags: ReturnType<typeof meta>) =>
  (tags.find((t) => "tagName" in t && t.rel === "canonical") as { href: string }).href;

describe("calendar route meta", () => {
  it("builds the head with the templated title, description, and canonical link", () => {
    const tags = metaAt("/calendar");
    expect(tags.some((t) => "title" in t && /Release Calendar/.test(String(t.title)))).toBe(true);
    const description = tags.find((t) => "name" in t && t.name === "description");
    expect(description).toBeDefined();
    expect(String((description as { content: string }).content)).not.toMatch(/physical/i);
    expect(tags.some((t) => "tagName" in t && t.tagName === "link" && t.rel === "canonical")).toBe(
      true,
    );
  });

  // The My films addresses carry their public twin's document, so they canonical to it — and
  // carry no noindex, which would contradict the canonical (NEU-1544).
  it.each([
    ["/calendar", "Release Calendar", "theatrical", "/calendar"],
    ["/calendar/at-home", "Home Release Calendar", "home", "/calendar/at-home"],
    ["/calendar/my-films", "My Films Calendar", "theatrical", "/calendar"],
    ["/calendar/my-films/at-home", "My Films Calendar", "home", "/calendar/at-home"],
  ] as const)("titles %s and canonicals it to its public twin", (path, title, kind, canonical) => {
    const tags = metaAt(path);
    expect(titleOf(tags)).toBe(`${title} — backlotter`);
    expect(descriptionOf(tags)).toBe(
      descriptionOf(metaAt(kind === "home" ? "/calendar/at-home" : "/calendar")),
    );
    expect(canonicalOf(tags)).toMatch(new RegExp(`${canonical}$`));
    expect(tags.some((t) => "name" in t && t.name === "robots")).toBe(false);
  });

  it("describes At home as the digital home release calendar", () => {
    expect(descriptionOf(metaAt("/calendar/at-home"))).toBe(
      "Upcoming US digital home releases by date for every film we track.",
    );
  });
});

/** The calendar route with the providers the public layout gives it: `CalendarView` reads
 *  `useAuth`, so every render of the page now needs an account query to resolve. These tests
 *  are the anonymous branch — the tabbed one lives in `components/calendar/CalendarView.test.tsx`
 *  — so `/me` answers 401 and the page is exactly the one it was before the tabs existed. */
function renderCalendar(
  routeLoader: () => { calendar: CalendarResponse; kind: CalendarKind },
  errorBoundary?: typeof ErrorBoundary,
  path = "/calendar",
) {
  server.use(unauthMeHandler());
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Stub = createRoutesStub([
    {
      path: "/calendar/*",
      Component: CalendarPage,
      loader: routeLoader,
      shouldRevalidate,
      ...(errorBoundary ? { ErrorBoundary: errorBoundary } : {}),
    },
    { path: "/film/:slug", Component: () => null },
    { path: "/", Component: () => <h1>Home</h1> },
  ]);
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Stub initialEntries={[path]} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("calendar route render", () => {
  it("renders title(year) rows grouped by date then release type, linking each to its film page", async () => {
    const { container } = renderCalendar(() => ({
      calendar: calendarTwoDates,
      kind: "theatrical",
    }));

    // Both date headings render
    expect(await screen.findByText(/July 4, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/July 11, 2026/)).toBeInTheDocument();

    // Short release-type group titles
    expect(screen.getAllByText("Wide").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Limited")).toBeInTheDocument();

    // Title(year) rows link to /film/{slug}; rows with a poster_path render a thumbnail
    const odyssey = screen.getByRole("link", { name: /The Odyssey/ });
    expect(odyssey).toHaveAttribute("href", "/film/the-odyssey-2026");
    expect(odyssey.textContent).toContain("(2026)");
    expect(screen.getByRole("link", { name: /Dune Part Three/ })).toHaveAttribute(
      "href",
      "/film/dune-3-2026",
    );
    expect(screen.getByRole("link", { name: /Avatar 3/ })).toHaveAttribute(
      "href",
      "/film/avatar-3-2026",
    );
    // Two of the three rows have poster_path set — expect two thumbnail images
    expect(screen.getAllByRole("img")).toHaveLength(2);

    // Soonest-first DOM order: July 4 heading appears before July 11 heading
    const timeEls = container.querySelectorAll("time");
    expect(timeEls[0].textContent).toMatch(/July 4, 2026/);
    expect(timeEls[timeEls.length - 1].textContent).toMatch(/July 11, 2026/);
  });

  it("renders the theatrical buckets with their own labels, in backend order", async () => {
    const { container } = renderCalendar(() => ({
      calendar: calendarWideAndLimited,
      kind: "theatrical",
    }));

    expect(await screen.findByText(/July 4, 2026/)).toBeInTheDocument();
    // Each bucket is its own sub-group under the shared date, ordered as the backend sent them.
    const groupLabels = Array.from(container.querySelectorAll("h5")).map((el) => el.textContent);
    expect(groupLabels).toEqual(["Wide", "Limited"]);
    expect(screen.getByRole("link", { name: /Dune Part Three/ })).toHaveAttribute(
      "href",
      "/film/dune-3-2026",
    );
  });

  it("loads the next page of dates when 'View more' is clicked (no autoload)", async () => {
    // Page 1 shows one date but total=2, so 'View more' appears; clicking fetches page 2.
    const page1: CalendarResponse = {
      items: [calendarTwoDates.items[0]],
      total: 2,
      limit: 20,
      offset: 0,
    };
    let captured: Headers | undefined;
    let kind: string | null = null;
    server.use(
      http.get(`${BACKEND}/calendar`, ({ request }) => {
        captured = request.headers;
        kind = new URL(request.url).searchParams.get("kind");
        return HttpResponse.json({
          items: [calendarTwoDates.items[2]],
          total: 2,
          limit: 20,
          offset: 1,
        });
      }),
    );
    renderCalendar(() => ({ calendar: page1, kind: "theatrical" }));
    expect(await screen.findByText(/July 4, 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/July 11, 2026/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /view more/i }));
    expect(await screen.findByText(/July 11, 2026/)).toBeInTheDocument();
    expect(kind).toBe("theatrical");
    // Browser-side paging is already per-visitor: it must never send the SSR signing headers.
    expect(captured?.get("X-Backlotter-Origin")).toBeNull();
    expect(captured?.get("X-Backlotter-Client-IP")).toBeNull();
  });

  it("says the dates are US ones, directly under the heading (ADR-0024)", async () => {
    renderCalendar(() => ({ calendar: calendarTwoDates, kind: "theatrical" }));
    const heading = await screen.findByRole("heading", { level: 1, name: "Calendar" });
    expect(heading.nextElementSibling).toHaveTextContent(
      "US release dates, in theaters and at home.",
    );
  });

  it("shows the empty state when there are no releases", async () => {
    const emptyCalendar: CalendarResponse = { items: [], total: 0, limit: 100, offset: 0 };
    renderCalendar(() => ({ calendar: emptyCalendar, kind: "theatrical" }));
    expect(await screen.findByText(/no upcoming theatrical releases yet/i)).toBeInTheDocument();
  });

  it("renders the At home calendar without a bucket heading under each date", async () => {
    let kind: string | null = null;
    server.use(
      http.get(`${BACKEND}/calendar`, ({ request }) => {
        kind = new URL(request.url).searchParams.get("kind");
        return HttpResponse.json({
          items: [{ ...calendarTwoDates.items[2], release_type: "digital" }],
          total: 1,
          limit: 20,
          offset: 0,
        } satisfies CalendarResponse);
      }),
    );
    const { container } = renderCalendar(() => ({
      calendar: calendarWideAndLimited,
      kind: "theatrical",
    }));
    await screen.findByText(/July 4, 2026/);

    await userEvent.click(screen.getByRole("radio", { name: "At home" }));

    expect(await screen.findByRole("link", { name: /Avatar 3/ })).toBeVisible();
    expect(kind).toBe("home");
    // The only h5s on the page are the hidden theatrical panel's; "Digital" never renders.
    for (const heading of container.querySelectorAll("h5")) expect(heading).not.toBeVisible();
    expect(screen.queryByText("Digital")).toBeNull();
  });

  it("renders year and month headings for multi-month data", async () => {
    const multiMonth: CalendarResponse = {
      items: [
        {
          film_ref: "film-june",
          film_title: "June Film",
          release_year: 2026,
          poster_path: null,
          release_date: "2026-06-20",
          release_type: "wide",
          director: null,
          stars: [],
          genres: [],
        },
        {
          film_ref: "film-july",
          film_title: "July Film",
          release_year: 2026,
          poster_path: null,
          release_date: "2026-07-04",
          release_type: "wide",
          director: null,
          stars: [],
          genres: [],
        },
      ],
      total: 2,
      limit: 20,
      offset: 0,
    };
    renderCalendar(() => ({ calendar: multiMonth, kind: "theatrical" }));
    expect(await screen.findByRole("heading", { name: "2026" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "June" })).toBeInTheDocument();
  });

  it("error boundary renders the not-found copy for a 404, linking to /calendar", async () => {
    renderCalendar(
      () => {
        throw new Response(null, { status: 404, statusText: "Calendar view not found" });
      },
      ErrorBoundary,
      "/calendar/nope",
    );
    expect(await screen.findByText(/that calendar view doesn't exist/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /release calendar/i })).toHaveAttribute(
      "href",
      "/calendar",
    );
  });

  it("error boundary renders neutral copy and a link home", async () => {
    renderCalendar(() => {
      throw new Error("network failure");
    }, ErrorBoundary);
    expect(await screen.findByText(/couldn't load the release calendar/i)).toBeInTheDocument();
    const homeLink = screen.getByRole("link", { name: /home/i });
    expect(homeLink).toHaveAttribute("href", "/");
  });
});
