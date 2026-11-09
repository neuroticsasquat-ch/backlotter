import { describe, expect, it } from "vitest";
import { loader } from "@/routes/robots";
import type { Route } from "./+types/robots";

describe("robots.txt", () => {
  it("allows crawl, disallows authed paths, and references a same-origin sitemap", async () => {
    const res = await loader({
      request: new Request("https://upmovies.example/robots.txt"),
    } as unknown as Route.LoaderArgs);
    const text = await res.text();

    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(text).toMatch(/^User-agent: \*$/m);
    expect(text).toMatch(/^Allow: \/$/m);
    expect(text).toMatch(/^Disallow: \/login$/m);
    expect(text).toMatch(/^Disallow: \/signup$/m);
    expect(text).toMatch(/^Disallow: \/admin\/$/m);
    expect(text).toContain("Sitemap: https://upmovies.example/sitemap.xml");
  });
});
