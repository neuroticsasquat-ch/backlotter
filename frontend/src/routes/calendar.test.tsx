import { RouterContextProvider, createRoutesStub } from "react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { cloudflareContext } from "@/lib/load-context";
import CalendarPage, { loader, meta, ErrorBoundary } from "@/routes/calendar";
import type { CalendarResponse } from "@/api/types";

const BACKEND = "https://api.upmovies.localhost";

const calendarTwoDates: CalendarResponse = {
  items: [
    {
      film_slug: "the-odyssey-2026",
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
      film_slug: "dune-3-2026",
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
      film_slug: "avatar-3-2026",
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

function contextWithEnv() {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, { env: { API_BASE_URL: BACKEND } });
  return context;
}

function callLoader() {
  return loader({
    request: new Request("https://upmovies.example/calendar"),
    context: contextWithEnv(),
    params: {},
  } as unknown as Parameters<typeof loader>[0]);
}

describe("calendar route loader", () => {
  it("fetches the calendar from the backend", async () => {
    server.use(http.get(`${BACKEND}/calendar`, () => HttpResponse.json(calendarTwoDates)));
    const data = await callLoader();
    expect(data.calendar.total).toBe(2);
    expect(data.calendar.items[0].film_slug).toBe("the-odyssey-2026");
  });
});

describe("calendar route meta", () => {
  it("builds the head with the templated title, description, and canonical link", () => {
    const tags = meta({
      location: { pathname: "/calendar" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags.some((t) => "title" in t && /Release Calendar/.test(String(t.title)))).toBe(true);
    expect(tags.some((t) => "name" in t && t.name === "description")).toBe(true);
    expect(tags.some((t) => "tagName" in t && t.tagName === "link" && t.rel === "canonical")).toBe(
      true,
    );
  });
});

describe("calendar route render", () => {
  it("renders title(year) rows grouped by date then release type, linking each to its film page", async () => {
    const Stub = createRoutesStub([
      {
        path: "/calendar",
        Component: CalendarPage,
        loader: () => ({ calendar: calendarTwoDates }),
      },
      { path: "/film/:slug", Component: () => null },
    ]);
    const { container } = render(<Stub initialEntries={["/calendar"]} />);

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

  it("loads the next page of dates when 'View more' is clicked (no autoload)", async () => {
    // Page 1 shows one date but total=2, so 'View more' appears; clicking fetches page 2.
    const page1: CalendarResponse = {
      items: [calendarTwoDates.items[0]],
      total: 2,
      limit: 20,
      offset: 0,
    };
    server.use(
      http.get(`${BACKEND}/calendar`, () =>
        HttpResponse.json({ items: [calendarTwoDates.items[2]], total: 2, limit: 20, offset: 1 }),
      ),
    );
    const Stub = createRoutesStub([
      { path: "/calendar", Component: CalendarPage, loader: () => ({ calendar: page1 }) },
      { path: "/film/:slug", Component: () => null },
    ]);
    render(<Stub initialEntries={["/calendar"]} />);
    expect(await screen.findByText(/July 4, 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/July 11, 2026/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /view more/i }));
    expect(await screen.findByText(/July 11, 2026/)).toBeInTheDocument();
  });

  it("shows the empty state when there are no releases", async () => {
    const emptyCalendar: CalendarResponse = { items: [], total: 0, limit: 100, offset: 0 };
    const Stub = createRoutesStub([
      {
        path: "/calendar",
        Component: CalendarPage,
        loader: () => ({ calendar: emptyCalendar }),
      },
    ]);
    render(<Stub initialEntries={["/calendar"]} />);
    expect(await screen.findByText(/no upcoming releases yet/i)).toBeInTheDocument();
  });

  it("renders year and month headings for multi-month data", async () => {
    const multiMonth: CalendarResponse = {
      items: [
        {
          film_slug: "film-june",
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
          film_slug: "film-july",
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
    const Stub = createRoutesStub([
      {
        path: "/calendar",
        Component: CalendarPage,
        loader: () => ({ calendar: multiMonth }),
      },
      { path: "/film/:slug", Component: () => null },
    ]);
    render(<Stub initialEntries={["/calendar"]} />);
    expect(await screen.findByRole("heading", { name: "2026" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "June" })).toBeInTheDocument();
  });

  it("error boundary renders neutral copy and a link home", async () => {
    const Stub = createRoutesStub([
      {
        path: "/calendar",
        Component: CalendarPage,
        ErrorBoundary,
        loader: () => {
          throw new Error("network failure");
        },
      },
    ]);
    render(<Stub initialEntries={["/calendar"]} />);
    expect(await screen.findByText(/couldn't load the release calendar/i)).toBeInTheDocument();
    const homeLink = screen.getByRole("link", { name: /home/i });
    expect(homeLink).toHaveAttribute("href", "/");
  });
});
