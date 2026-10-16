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
