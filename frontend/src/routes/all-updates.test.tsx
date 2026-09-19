import { RouterContextProvider, createRoutesStub } from "react-router";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { meHandler, unauthMeHandler } from "@/test/msw/me";
import { feed } from "@/test/feed-fixtures";
import { cloudflareContext, type AppEnv } from "@/lib/load-context";
import { AuthProvider } from "@/components/AuthContext";
import AllUpdatesPage, { loader, meta } from "@/routes/all-updates";

const BACKEND = "https://api.upmovies.localhost";

function callLoader(env: Partial<AppEnv> = {}, headers: Record<string, string> = {}) {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, { env: { API_BASE_URL: BACKEND, ...env } });
  return loader({
    request: new Request("https://upmovies.example/feed", { headers }),
    context,
    params: {},
  } as unknown as Parameters<typeof loader>[0]);
}

describe("all-updates route loader", () => {
  it("SSRs the same global grouped feed the home route does", async () => {
    server.use(http.get(`${BACKEND}/feed/grouped`, () => HttpResponse.json(feed)));
    const data = await callLoader();
    expect(data.feed.total).toBe(2);
    expect(data.feed.items[0].film_ref).toBe("the-odyssey-2026");
  });

  it("signs the fetch like every other public loader", async () => {
    let captured: Headers | undefined;
    server.use(
      http.get(`${BACKEND}/feed/grouped`, ({ request }) => {
        captured = request.headers;
        return HttpResponse.json(feed);
      }),
    );
    await callLoader({ SSR_ORIGIN_SECRET: "s3cret" }, { "CF-Connecting-IP": "203.0.113.7" });
    expect(captured?.get("X-Backlotter-Origin")).toBe("s3cret");
    expect(captured?.get("X-Backlotter-Client-IP")).toBe("203.0.113.7");
  });
});

describe("all-updates route meta", () => {
  it("self-canonicalises to /feed rather than back to the home page", () => {
    const tags = meta({
      location: { pathname: "/feed" },
    } as unknown as Parameters<typeof meta>[0]);
    const canonical = tags.find(
      (t) => "tagName" in t && t.tagName === "link" && t.rel === "canonical",
    );
    expect(canonical).toMatchObject({ href: "https://app.upmovies.localhost/feed" });
    expect(tags).toContainEqual({ title: "All updates — backlotter" });
  });

  it("keeps the description the home page used to carry", () => {
    const tags = meta({
      location: { pathname: "/feed" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags).toContainEqual({
      name: "description",
      content:
        "The latest casting, trailers, release dates, and production updates across every movie we track.",
    });
  });
});

function renderAllUpdates() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Stub = createRoutesStub([
    { path: "/feed", Component: AllUpdatesPage, loader: () => ({ feed }) },
  ]);
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Stub initialEntries={["/feed"]} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("all-updates route render", () => {
  it("renders the global feed under its own heading for an anonymous visitor", async () => {
    server.use(unauthMeHandler());
    renderAllUpdates();

    expect(await screen.findByRole("heading", { name: "All updates" })).toBeInTheDocument();
    expect(screen.getByText("The Odyssey")).toBeInTheDocument();
  });

  it("renders the same global feed for a signed-in, entitled reader", async () => {
    // The point of the route: it is the unfiltered feed for *everyone*, so it must not swap to
    // a timeline the way `/` does.
    server.use(meHandler({ entitled: true }));
    renderAllUpdates();

    expect(await screen.findByRole("heading", { name: "All updates" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "My feed" })).toBeNull();
    expect(screen.getByText("The Odyssey")).toBeInTheDocument();
  });
});
