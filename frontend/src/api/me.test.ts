import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { entitlementRequiredHandlers, followGraphHandlers } from "@/test/msw/follows";
import { env } from "@/env";
import { ApiError } from "./client";
import {
  createFollow,
  deleteFollow,
  fetchFollows,
  fetchWatchlist,
  addToWatchlist,
  isEntitlementError,
  removeFromWatchlist,
} from "./me";

const base = env.apiBaseUrl;

const PERSON = { entityType: "person" as const, entityId: "505710", label: "Zendaya" };
const FILM_ID = "11111111-1111-4111-8111-111111111111";

describe("isEntitlementError", () => {
  it("recognises the 403 the gate answers with", () => {
    expect(
      isEntitlementError(new ApiError(403, "forbidden", { detail: "entitlement_required" })),
    ).toBe(true);
  });

  it("leaves every other failure alone", () => {
    // A 403 for another reason, a different status, and a non-ApiError all stay errors: the
    // locked state is a specific thing to render, not a catch-all for "the write failed".
    expect(isEntitlementError(new ApiError(403, "forbidden", { detail: "csrf_invalid" }))).toBe(
      false,
    );
    expect(isEntitlementError(new ApiError(404, "not found", { detail: "follow_not_found" }))).toBe(
      false,
    );
    expect(isEntitlementError(new Error("network"))).toBe(false);
  });
});

describe("follow fetchers", () => {
  it("round-trips a follow through create, list and delete", async () => {
    const graph = followGraphHandlers();
    server.use(...graph.handlers);

    await createFollow(PERSON);
    expect((await fetchFollows()).items).toEqual([
      expect.objectContaining({ entity_type: "person", entity_id: "505710", source: "manual" }),
    ]);

    await deleteFollow(PERSON);
    expect((await fetchFollows()).items).toEqual([]);
  });

  it("posts the entity as the backend spells it", async () => {
    let body: unknown;
    server.use(
      http.post(`${base}/me/follows`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({}, { status: 201 });
      }),
    );

    await createFollow(PERSON);

    expect(body).toEqual({ entity_type: "person", entity_id: "505710" });
  });

  it("addresses the unfollow by type and id", async () => {
    let path = "";
    server.use(
      http.delete(`${base}/me/follows/:entityType/:entityId`, ({ request }) => {
        path = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await deleteFollow({ entityType: "title", entityId: FILM_ID, label: "The Odyssey" });

    expect(path).toBe(`/me/follows/title/${FILM_ID}`);
  });
});

describe("watchlist fetchers", () => {
  it("round-trips a film through add, list and remove", async () => {
    const graph = followGraphHandlers();
    server.use(...graph.handlers);

    await addToWatchlist(FILM_ID);
    expect((await fetchWatchlist()).items).toEqual([
      expect.objectContaining({ source: "manual", alert_prefs: ["stream"] }),
    ]);

    await removeFromWatchlist(FILM_ID);
    expect((await fetchWatchlist()).items).toEqual([]);
  });

  it("sends the film id alone, leaving the backend to apply the default prefs", async () => {
    let body: unknown;
    server.use(
      http.post(`${base}/me/watchlist`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({}, { status: 201 });
      }),
    );

    await addToWatchlist(FILM_ID);

    expect(body).toEqual({ film_id: FILM_ID });
  });

  it("surfaces the entitlement 403 as an error the caller can recognise", async () => {
    server.use(...entitlementRequiredHandlers());

    await expect(addToWatchlist(FILM_ID)).rejects.toSatisfy(isEntitlementError);
  });
});
