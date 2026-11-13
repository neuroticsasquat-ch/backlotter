import { isRouteErrorResponse } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/react";
import { ApiOverloadedError, ApiUnavailableError } from "@/api/public";
import { busyHeaders, busyOnOverload, isBusy } from "./overload";

vi.mock("@sentry/react", () => ({ captureException: vi.fn() }));

/** What `busyOnOverload` threw: React Router's `data(…)` result, as its status and headers. */
async function thrownBy(error: Error) {
  const thrown = await busyOnOverload(async () => {
    throw error;
  }).catch((e: unknown) => e);
  expect(thrown).toMatchObject({ type: "DataWithResponseInit" });
  const { init } = thrown as { init: ResponseInit };
  return { status: init.status, retryAfter: new Headers(init.headers).get("Retry-After") };
}

describe("busyOnOverload", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes a loader's result through", async () => {
    await expect(busyOnOverload(async () => ({ ok: true }))).resolves.toEqual({ ok: true });
  });

  it("turns the API's overload answer into a 503 carrying Retry-After, unreported", async () => {
    expect(await thrownBy(new ApiOverloadedError("/people/x", 7))).toEqual({
      status: 503,
      retryAfter: "7",
    });
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("turns an unreachable API into the same 503, and reports it once", async () => {
    const error = new ApiUnavailableError("/people/x", 502);
    expect(await thrownBy(error)).toEqual({ status: 503, retryAfter: "5" });
    expect(Sentry.captureException).toHaveBeenCalledOnce();
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });

  it("rethrows every other error untouched", async () => {
    const boom = new Error("GET /people/x failed: 500");
    await expect(
      busyOnOverload(async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});

describe("isBusy", () => {
  it("is true only for a 503 route error response", () => {
    const busy = { status: 503, statusText: "Service Unavailable", internal: false, data: null };
    // The shape React Router hands a boundary for a thrown `data(…, { status: 503 })`.
    expect(isRouteErrorResponse(busy)).toBe(true);
    expect(isBusy(busy)).toBe(true);
    expect(isBusy({ ...busy, status: 404 })).toBe(false);
    expect(isBusy(new Error("503"))).toBe(false);
  });
});

describe("busyHeaders", () => {
  it("adds the busy 503's Retry-After to the parent's headers", () => {
    const headers = busyHeaders({
      parentHeaders: new Headers({ "X-Parent": "1" }),
      loaderHeaders: new Headers(),
      actionHeaders: new Headers(),
      errorHeaders: new Headers({ "Retry-After": "5" }),
    });
    expect(headers.get("Retry-After")).toBe("5");
    expect(headers.get("X-Parent")).toBe("1");
  });

  it("passes the parent's headers through unchanged otherwise", () => {
    const headers = busyHeaders({
      parentHeaders: new Headers({ "X-Parent": "1" }),
      loaderHeaders: new Headers(),
      actionHeaders: new Headers(),
      errorHeaders: undefined,
    });
    expect([...headers]).toEqual([["x-parent", "1"]]);
  });
});
