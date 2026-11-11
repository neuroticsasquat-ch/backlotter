import { afterEach, describe, expect, it, vi } from "vitest";

// `__GIT_SHA__` is compiled in by vite.config.ts on a build that knows its commit; tests have no
// define, so a global stands in for it and each case re-imports the module to re-read it.
describe("sentryRelease", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("is the build's git SHA when one was compiled in", async () => {
    vi.stubGlobal("__GIT_SHA__", "abc123def");
    const { sentryRelease } = await import("./sentry");
    expect(sentryRelease).toBe("abc123def");
  });

  it("is undefined, not a placeholder, when the build had no SHA", async () => {
    const { sentryRelease } = await import("./sentry");
    expect(sentryRelease).toBeUndefined();
  });
});

describe("shouldInitBrowserSentry", () => {
  const CHROME =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/130.0.0.0 Safari/537.36";

  it("skips the Lightpanda headless crawler, whatever the case", async () => {
    const { shouldInitBrowserSentry } = await import("./sentry");
    expect(shouldInitBrowserSentry("Lightpanda/1.0")).toBe(false);
    expect(shouldInitBrowserSentry("lightpanda/2.3")).toBe(false);
  });

  it("initialises for a real browser", async () => {
    const { shouldInitBrowserSentry } = await import("./sentry");
    expect(shouldInitBrowserSentry(CHROME)).toBe(true);
  });

  it("initialises when the user agent is empty", async () => {
    const { shouldInitBrowserSentry } = await import("./sentry");
    expect(shouldInitBrowserSentry("")).toBe(true);
  });
});
