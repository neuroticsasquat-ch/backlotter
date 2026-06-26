import { RouterContextProvider } from "react-router";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { cloudflareContext } from "@/lib/load-context";
import { loader } from "@/routes/sitemap";
import type { Route } from "./+types/sitemap";

const BACKEND = "https://api.upmovies.localhost";

function contextWithEnv() {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, { env: { API_BASE_URL: BACKEND } });
  return context;
}

describe("sitemap.xml", () => {
  it("proxies the backend sitemap as application/xml", async () => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset></urlset>';
    server.use(
      http.get(`${BACKEND}/sitemap.xml`, () =>
        HttpResponse.xml(xml, { headers: { "Content-Type": "application/xml" } }),
      ),
    );

    const res = await loader({
      request: new Request("https://upmovies.example/sitemap.xml"),
      context: contextWithEnv(),
      params: {},
    } as unknown as Route.LoaderArgs);

    expect(res.headers.get("content-type")).toContain("application/xml");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(await res.text()).toBe(xml);
  });

  it("injects /browse and /calendar url entries and preserves the root entry", async () => {
    const APP_BASE = "https://app.upmovies.localhost";
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<urlset>",
      `<url><loc>${APP_BASE}/</loc></url>`,
      "</urlset>",
    ].join("\n");
    server.use(
      http.get(`${BACKEND}/sitemap.xml`, () =>
        HttpResponse.xml(xml, { headers: { "Content-Type": "application/xml" } }),
      ),
    );

    const res = await loader({
      request: new Request("https://upmovies.example/sitemap.xml"),
      context: contextWithEnv(),
      params: {},
    } as unknown as Route.LoaderArgs);

    expect(res.headers.get("content-type")).toContain("application/xml");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");

    const body = await res.text();
    expect(body).toContain(`<loc>${APP_BASE}/</loc>`);
    expect(body).toContain(`<loc>${APP_BASE}/browse</loc>`);
    expect(body).toContain(`<loc>${APP_BASE}/calendar</loc>`);
  });

  it("anchors the /browse entry to the site origin even when the first <loc> is a deep path", async () => {
    const APP_BASE = "https://app.upmovies.localhost";
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<urlset>",
      `<url><loc>${APP_BASE}/film/the-odyssey-2026</loc></url>`,
      "</urlset>",
    ].join("\n");
    server.use(
      http.get(`${BACKEND}/sitemap.xml`, () =>
        HttpResponse.xml(xml, { headers: { "Content-Type": "application/xml" } }),
      ),
    );

    const res = await loader({
      request: new Request("https://upmovies.example/sitemap.xml"),
      context: contextWithEnv(),
      params: {},
    } as unknown as Route.LoaderArgs);

    const body = await res.text();
    expect(body).toContain(`<loc>${APP_BASE}/browse</loc>`);
    expect(body).not.toContain("/film/the-odyssey-2026/browse");
  });

  it("returns 503 with an empty sitemap when the backend is unreachable", async () => {
    server.use(http.get(`${BACKEND}/sitemap.xml`, () => HttpResponse.error()));

    const res = await loader({
      request: new Request("https://upmovies.example/sitemap.xml"),
      context: contextWithEnv(),
      params: {},
    } as unknown as Route.LoaderArgs);

    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("application/xml");
  });
});
