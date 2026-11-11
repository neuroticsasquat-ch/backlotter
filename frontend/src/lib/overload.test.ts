import { isRouteErrorResponse } from "react-router";
import { describe, expect, it } from "vitest";
import { ApiOverloadedError } from "@/api/public";
import { busyHeaders, busyOnOverload, isBusy } from "./overload";

describe("busyOnOverload", () => {
  it("passes a loader's result through", async () => {
    await expect(busyOnOverload(async () => ({ ok: true }))).resolves.toEqual({ ok: true });
  });

  it("turns the API's overload answer into a 503 carrying Retry-After", async () => {
    const thrown = await busyOnOverload(async () => {
      throw new ApiOverloadedError("/people/x", 7);
    }).catch((e: unknown) => e);
    expect(thrown).toMatchObject({ type: "DataWithResponseInit" });
    const { init } = thrown as { init: ResponseInit };
    expect(init.status).toBe(503);
    expect(new Headers(init.headers).get("Retry-After")).toBe("7");
  });

  it("rethrows every other error untouched", async () => {
    const boom = new Error("GET /people/x failed: 500");
    await expect(
      busyOnOverload(async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
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
