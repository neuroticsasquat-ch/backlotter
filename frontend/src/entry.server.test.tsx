import {
  createRequestHandler,
  Outlet,
  RouterContextProvider,
  type ServerBuild,
  UNSAFE_withErrorBoundaryProps as withErrorBoundaryProps,
} from "react-router";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/cloudflare";
import * as BrowserSentry from "@sentry/react";
import { server } from "@/test/msw/server";
import { EMPTY_ACTIVITY } from "@/api/public";
import { cloudflareContext } from "@/lib/load-context";
import * as entryServer from "@/entry.server";
import * as personRoute from "@/routes/person";

vi.mock("@sentry/cloudflare", () => ({ captureException: vi.fn() }));
// `lib/overload.ts` reports through `@sentry/react`, which shares the Worker SDK's scope.
vi.mock("@sentry/react", () => ({ captureException: vi.fn() }));

const BACKEND = "https://api.upmovies.localhost";

/**
 * A document request for `/person/:ref` through React Router's own request handler, with the
 * real server entry and the real person route module (NEU-2273). The server build is the
 * smallest one that renders: a root that is only an `<Outlet />`, and an assets manifest whose
 * module URLs are never fetched because nothing renders `<Scripts />`. The boundary is wrapped
 * the way the framework's build wraps it, which is what hands it its `error` prop.
 */
function entryRoute(id: string, path: string, parentId?: string) {
  return {
    id,
    path,
    parentId,
    module: `/${id}.js`,
    hasAction: false,
    hasLoader: id !== "root",
    hasClientAction: false,
    hasClientLoader: false,
    hasClientMiddleware: false,
    hasErrorBoundary: id !== "root",
    clientActionModule: undefined,
    clientLoaderModule: undefined,
    clientMiddlewareModule: undefined,
    hydrateFallbackModule: undefined,
  };
}

const build = {
  entry: { module: entryServer },
  routes: {
    root: { id: "root", path: "", module: { default: () => <Outlet /> } },
    "routes/person": {
      id: "routes/person",
      parentId: "root",
      path: "person/:ref",
      module: { ...personRoute, ErrorBoundary: withErrorBoundaryProps(personRoute.ErrorBoundary) },
    },
  },
  assets: {
    entry: { imports: [], module: "/entry.client.js" },
    routes: {
      root: entryRoute("root", ""),
      "routes/person": entryRoute("routes/person", "person/:ref", "root"),
    },
    url: "/manifest.js",
    version: "test",
  },
  publicPath: "/",
  assetsBuildDirectory: "build/client",
  future: {},
  ssr: true,
  isSpaMode: false,
  prerender: [],
  routeDiscovery: { mode: "initial", manifestPath: "/__manifest" },
} as unknown as ServerBuild;

async function requestPerson(ref: string) {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, { env: { API_BASE_URL: BACKEND } as never });
  const res = await createRequestHandler(build, "production")(
    new Request(`https://backlotter.example/person/${ref}`),
    context,
  );
  return { res, html: await res.text() };
}

describe("a person page whose loader the API could not serve", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    server.use(http.get(`${BACKEND}/people/:ref/events`, () => HttpResponse.json(EMPTY_ACTIVITY)));
  });

  afterEach(() => {
    consoleError.mockRestore();
    vi.clearAllMocks();
  });

  it("renders the busy page as a 503 with the API's Retry-After, unreported", async () => {
    server.use(
      http.get(`${BACKEND}/people/:ref`, () =>
        HttpResponse.json(
          { detail: "overloaded", retry_after: 5 },
          { status: 503, headers: { "Retry-After": "5" } },
        ),
      ),
    );
    const { res, html } = await requestPerson("525-christopher-nolan");
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
    expect(html).toContain("Busy right now");
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(BrowserSentry.captureException).not.toHaveBeenCalled();
  });

  it("renders the busy page for a proxy's 503, reported once by the loader", async () => {
    server.use(
      http.get(
        `${BACKEND}/people/:ref`,
        () => new HttpResponse("no available server", { status: 503 }),
      ),
    );
    const { res, html } = await requestPerson("525-christopher-nolan");
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
    expect(html).toContain("Busy right now");
    expect(BrowserSentry.captureException).toHaveBeenCalledOnce();
    expect(vi.mocked(BrowserSentry.captureException).mock.calls[0][0]).toMatchObject({
      name: "ApiUnavailableError",
      status: 503,
    });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("still renders the error page as a 500 for an API failure, and reports it", async () => {
    server.use(http.get(`${BACKEND}/people/:ref`, () => new HttpResponse(null, { status: 500 })));
    const { res, html } = await requestPerson("525-christopher-nolan");
    expect(res.status).toBe(500);
    expect(res.headers.get("Retry-After")).toBeNull();
    expect(html).toContain("Something went wrong");
    expect(Sentry.captureException).toHaveBeenCalledOnce();
    expect(vi.mocked(Sentry.captureException).mock.calls[0][0]).toMatchObject({
      message: expect.stringMatching(/failed: 500/),
    });
  });

  it("does not report a 404", async () => {
    server.use(http.get(`${BACKEND}/people/:ref`, () => new HttpResponse(null, { status: 404 })));
    const { res } = await requestPerson("missing");
    expect(res.status).toBe(404);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
