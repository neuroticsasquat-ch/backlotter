import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "@/env";
import { calendarFeedUrls } from "@/lib/ical-url";

describe("calendarFeedUrls", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("hangs the token off the API origin as a .ics path", () => {
    expect(calendarFeedUrls("tok-123").https).toBe(`${env.apiBaseUrl}/calendar/tok-123.ics`);
  });

  it("offers the same URL under the webcal scheme", () => {
    const { https, webcal } = calendarFeedUrls("tok-123");
    expect(webcal).toBe(https.replace("https:", "webcal:"));
    expect(webcal.startsWith("webcal://")).toBe(true);
  });

  it("escapes a token that would otherwise change the path", () => {
    expect(calendarFeedUrls("a/b").https).toBe(`${env.apiBaseUrl}/calendar/a%2Fb.ics`);
  });

  /** Dev sets `VITE_API_BASE_URL=/api` and lets the dev server proxy it. A URL a calendar app
   *  is asked to poll forever has to be absolute, and there is no scheme for `webcal:` to
   *  replace in a relative one — so the page's own origin, which is what proxies `/api`,
   *  stands in for it. */
  it("resolves a relative API base against the page origin", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "/api");
    vi.resetModules();
    const { calendarFeedUrls: withRelativeBase } = await import("@/lib/ical-url");

    const { https, webcal } = withRelativeBase("tok-123");
    expect(https).toBe(`${window.location.origin}/api/calendar/tok-123.ics`);
    expect(webcal).toBe(
      `${window.location.origin.replace(/^https?:/, "webcal:")}/api/calendar/tok-123.ics`,
    );
  });
});
