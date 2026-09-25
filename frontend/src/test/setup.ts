import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "./msw/server";
import { clearTimelineHint } from "@/lib/timeline-hint";

// jsdom does not implement some browser APIs used by UI primitives; polyfill them.
if (typeof window !== "undefined") {
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.setPointerCapture = () => undefined;
  window.HTMLElement.prototype.releasePointerCapture = () => undefined;
  window.HTMLElement.prototype.scrollIntoView = () => undefined;
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (window as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver ??=
    ResizeObserverStub as unknown as typeof ResizeObserver;
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  // jsdom's cookie jar outlives a test: an entitled `/me` in one would otherwise hand the next
  // one a timeline hint it never asked for (NEU-1468).
  clearTimelineHint();
});
afterAll(() => server.close());
