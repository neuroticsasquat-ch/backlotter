import { act } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import {
  createMemoryRouter,
  createStaticHandler,
  createStaticRouter,
  RouterProvider,
  StaticRouterProvider,
  useLoaderData,
  type RouteObject,
} from "react-router";
import { delay, http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "@/env";
import { server } from "@/test/msw/server";
import { feed } from "@/test/feed-fixtures";
import { accountQueryClient } from "@/components/layout/HeaderAccount";
import PublicLayout, { loader as layoutLoader, publicQueryClient } from "@/routes/public-layout";
import FeedPage from "@/routes/feed";

/**
 * `/` through a server render and a hydration, with and without the timeline hint (NEU-1468).
 *
 * The route objects mirror what framework mode builds from `routes.ts`: the real layout loader
 * and components, with `loaderData` handed in as a prop the way the route-module wrapper does.
 * The page's own loader is stood in for, since what it fetches is not what is under test.
 */
const routes: RouteObject[] = [
  {
    id: "routes/public-layout",
    path: "/",
    loader: ({ request }) =>
      layoutLoader({ request } as unknown as Parameters<typeof layoutLoader>[0]),
    Component: () => (
      <PublicLayout loaderData={useLoaderData() as ReturnType<typeof layoutLoader>} />
    ),
    children: [
      {
        id: "routes/feed",
        index: true,
        loader: () => ({ feed }),
        Component: () => (
          <FeedPage
            {...({ loaderData: useLoaderData() } as unknown as Parameters<typeof FeedPage>[0])}
          />
        ),
      },
    ],
  },
];

async function serverRender(headers: Record<string, string>) {
  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request("https://backlotter.example/", { headers }));
  if (context instanceof Response) throw new Error("unexpected redirect");
  const router = createStaticRouter(handler.dataRoutes, context);
  const html = renderToString(
    <StaticRouterProvider router={router} context={context} hydrate={false} />,
  );
  return { html, loaderData: context.loaderData };
}

/** A fresh document for the markup, as a browser would parse it. */
function parse(html: string) {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

describe("server render of / (NEU-1468)", () => {
  beforeEach(() => {
    // The two module-level clients stand in for a fresh isolate and a fresh tab.
    publicQueryClient.clear();
    accountQueryClient.clear();
    // Held open: the server never sees an answer, and hydration must happen before one lands.
    server.use(
      http.get(`${env.apiBaseUrl}/me`, async () => {
        await delay(200);
        return HttpResponse.json({ detail: "auth_required" }, { status: 401 });
      }),
    );
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders the timeline skeleton for a request carrying the hint", async () => {
    const { html } = await serverRender({ Cookie: "session=x; timeline_hint=1" });
    const doc = parse(html);

    const headings = [...doc.querySelectorAll("h1")].map((h) => h.textContent);
    expect(headings).toContain("My feed");
    expect(headings).not.toContain("All updates");
    expect(doc.querySelector('[aria-label="Loading your timeline"]')).not.toBeNull();
    // The nav's two-item form, from the first byte.
    const nav = doc.querySelector('nav[aria-label="Primary navigation"]');
    expect([...(nav?.querySelectorAll("a") ?? [])].map((a) => a.textContent)).toEqual([
      "My feed",
      "All updates",
      "Calendar",
    ]);
  });

  it("renders the global feed for a request without it, as before", async () => {
    const { html } = await serverRender({ Cookie: "session=x" });
    const doc = parse(html);

    const headings = [...doc.querySelectorAll("h1")].map((h) => h.textContent);
    expect(headings).toContain("All updates");
    expect(headings).not.toContain("My feed");
    expect(doc.querySelector('[aria-label="Loading your timeline"]')).toBeNull();
  });

  it.each([
    ["with the hint", { Cookie: "timeline_hint=1" }],
    ["without the hint", {}],
  ])("hydrates %s without a mismatch", async (_, headers) => {
    const { html, loaderData } = await serverRender(headers);
    // The jar is left empty on purpose: hydration must read the loader's answer (the server
    // snapshot), and a hydration pass that read the jar instead would mismatch the hinted case.
    const container = document.body.appendChild(parse(html));
    const recoverable = vi.fn();
    const consoleError = vi.spyOn(console, "error");

    const router = createMemoryRouter(routes, { hydrationData: { loaderData } });
    await act(async () => {
      hydrateRoot(container, <RouterProvider router={router} />, {
        onRecoverableError: recoverable,
      });
    });

    expect(recoverable).not.toHaveBeenCalled();
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/hydrat|did not match/i);
  });
});
