import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/test/msw/server";
import { env } from "@/env";
import { ApiError, apiFetch, setCsrfToken } from "./client";

describe("apiFetch", () => {
  afterEach(() => server.resetHandlers());

  it("returns parsed JSON on 2xx", async () => {
    server.use(http.get(`${env.apiBaseUrl}/ping`, () => HttpResponse.json({ ok: true })));
    const result = await apiFetch<{ ok: boolean }>("/ping");
    expect(result).toEqual({ ok: true });
  });

  it("throws ApiError on non-2xx with detail message", async () => {
    server.use(
      http.get(`${env.apiBaseUrl}/fail`, () =>
        HttpResponse.json({ detail: "nope" }, { status: 404 }),
      ),
    );
    await expect(apiFetch("/fail")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      message: "nope",
    });
  });

  it("throws ApiError with generic message when body has no detail", async () => {
    server.use(http.get(`${env.apiBaseUrl}/fail`, () => new HttpResponse(null, { status: 500 })));
    await expect(apiFetch("/fail")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("apiFetch — auth + csrf", () => {
  beforeEach(() => {
    setCsrfToken(null);
  });

  afterEach(() => {
    server.resetHandlers();
    vi.restoreAllMocks();
  });

  it("includes credentials on every request", async () => {
    // Read off the `fetch` call, not the handler's request: MSW 3 re-parses a Node `fetch` off
    // the socket, and the request it rebuilds always says `same-origin`.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    server.use(http.get(`${env.apiBaseUrl}/probe`, () => HttpResponse.json({ ok: true })));
    await apiFetch("/probe");
    expect(fetchSpy.mock.calls[0]?.[1]?.credentials).toBe("include");
  });

  it("attaches X-CSRF-Token from in-memory csrf token on POST", async () => {
    setCsrfToken("abc123");
    let observedHeader: string | null = null;
    server.use(
      http.post(`${env.apiBaseUrl}/echo`, ({ request }) => {
        observedHeader = request.headers.get("X-CSRF-Token");
        return HttpResponse.json({});
      }),
    );
    await apiFetch("/echo", { method: "POST", body: "{}" });
    expect(observedHeader).toBe("abc123");
  });

  it("does not attach X-CSRF-Token when token is unset", async () => {
    let observedHeader: string | null = "sentinel";
    server.use(
      http.post(`${env.apiBaseUrl}/echo`, ({ request }) => {
        observedHeader = request.headers.get("X-CSRF-Token");
        return HttpResponse.json({});
      }),
    );
    await apiFetch("/echo", { method: "POST", body: "{}" });
    expect(observedHeader).toBeNull();
  });

  it("returns undefined for 204", async () => {
    server.use(
      http.delete(`${env.apiBaseUrl}/gone`, () => new HttpResponse(null, { status: 204 })),
    );
    const result = await apiFetch<void>("/gone", { method: "DELETE" });
    expect(result).toBeUndefined();
  });
});
