import { RouterContextProvider, createRoutesStub } from "react-router";
import { render, screen } from "@testing-library/react";
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
      poster_path: "/odyssey.jpg",
      release_date: "2026-07-04",
      release_type: "premiere",
    },
    {
      film_slug: "dune-3-2026",
      film_title: "Dune Part Three",
      poster_path: null,
      release_date: "2026-07-04",
      release_type: "wide",
    },
    {
      film_slug: "avatar-3-2026",
      film_title: "Avatar 3",
      poster_path: "/avatar3.jpg",
      release_date: "2026-07-11",
      release_type: "wide",
    },
  ],
  total: 3,
  limit: 100,
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
    expect(data.calendar.total).toBe(3);
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
  it("groups films by date (soonest-first) then by release type, and links each card to its film page", async () => {
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

    // Per-type labels render (from the July 4 date which has premiere + wide)
    expect(screen.getByText("Premiere")).toBeInTheDocument();
    expect(screen.getAllByText("Wide release").length).toBeGreaterThanOrEqual(1);

    // Films link to /film/{slug}
    const odyssey = screen.getByRole("link", { name: /The Odyssey/ });
    expect(odyssey).toHaveAttribute("href", "/film/the-odyssey-2026");
    const dune = screen.getByRole("link", { name: /Dune Part Three/ });
    expect(dune).toHaveAttribute("href", "/film/dune-3-2026");
    const avatar = screen.getByRole("link", { name: /Avatar 3/ });
    expect(avatar).toHaveAttribute("href", "/film/avatar-3-2026");

    // Soonest-first DOM order: July 4 heading appears before July 11 heading
    const timeEls = container.querySelectorAll("time");
    expect(timeEls[0].textContent).toMatch(/July 4, 2026/);
    expect(timeEls[timeEls.length - 1].textContent).toMatch(/July 11, 2026/);
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
