import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import {
  entitlementRequiredHandlers,
  followGraphHandlers,
  makeWatchlistItem,
} from "@/test/msw/follows";
import { settingsHandlers } from "@/test/msw/settings";
import { env } from "@/env";
import { ApiError } from "./client";
import { timelineKey, watchlistCalendarPageKey, watchlistKey } from "./query-keys";
import {
  useToggleWatchlist,
  createFollow,
  deleteFollow,
  fetchFollows,
  fetchTimeline,
  fetchWatchlist,
  fetchWatchlistCalendar,
  fetchSettings,
  addToWatchlist,
  isEntitlementError,
  removeFromWatchlist,
  updateAlertStores,
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
  it("round-trips a film through want, list and stop", async () => {
    const graph = followGraphHandlers();
    server.use(...graph.handlers);

    await addToWatchlist(FILM_ID);
    expect((await fetchWatchlist()).items).toEqual([
      expect.objectContaining({ followed: true, muted: false }),
    ]);

    // Nothing but the film's own title follow covers it, so stopping takes it off the list
    // rather than muting it.
    await removeFromWatchlist(FILM_ID);
    expect((await fetchWatchlist()).items).toEqual([]);
  });

  it("mutes rather than removes a film another follow still covers", async () => {
    const graph = followGraphHandlers({
      watchlist: [
        makeWatchlistItem({
          followed: true,
          covered_by: [
            { entity_type: "title", entity_id: FILM_ID, name: "The Odyssey" },
            { entity_type: "person", entity_id: "525", name: "Christopher Nolan" },
          ],
          film: { id: FILM_ID },
        }),
      ],
    });
    server.use(...graph.handlers);

    const stopped = await removeFromWatchlist(FILM_ID);

    // 200 with the item, not a 204: the film is still covered, so there is something left to
    // describe — and it is muted, and no longer directly followed.
    expect(stopped).toMatchObject({ muted: true, followed: false });
    expect((await fetchWatchlist()).items).toHaveLength(1);
  });

  it("sends the film id alone — there are no per-film preferences left to send", async () => {
    let body: unknown;
    server.use(
      http.post(`${base}/me/watchlist`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({}, { status: 200 });
      }),
    );

    await addToWatchlist(FILM_ID);

    expect(body).toEqual({ film_id: FILM_ID });
  });

  it("surfaces the entitlement 403 as an error the caller can recognise", async () => {
    server.use(...entitlementRequiredHandlers());

    await expect(addToWatchlist(FILM_ID)).rejects.toSatisfy(isEntitlementError);
  });

  it("PATCHes the whole store set, which is how an empty one is expressible", async () => {
    let body: unknown;
    server.use(
      http.patch(`${base}/me/settings`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({}, { status: 200 });
      }),
    );

    await updateAlertStores([]);

    // Not a delta and not an omission: `{}` would mean "unchanged" to a PATCH, while an
    // explicit empty list is the user asking for no availability alerts at all (D-44).
    expect(body).toEqual({ alert_stores: [] });
  });

  it("round-trips a store change through the settings row", async () => {
    const settings = settingsHandlers();
    server.use(...settings.handlers);

    await updateAlertStores(["buy", "rent"]);

    expect((await fetchSettings()).alert_stores).toEqual(["buy", "rent"]);
    // The cadence is untouched: the PATCH named one field, which is the whole point of the
    // backend's two-optional-field request model.
    expect((await fetchSettings()).digest_cadence).toBe("weekly");
  });

  it("surfaces the entitlement 403 on a store change too", async () => {
    server.use(
      http.patch(`${base}/me/settings`, () =>
        HttpResponse.json({ detail: "entitlement_required" }, { status: 403 }),
      ),
    );

    await expect(updateAlertStores(["stream"])).rejects.toSatisfy(isEntitlementError);
  });
});

describe("timeline fetcher", () => {
  it("pages through query parameters the backend's grouped contract understands", async () => {
    let url: URL | undefined;
    server.use(
      http.get(`${base}/me/timeline`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({ items: [], total: 0, limit: 10, offset: 20 });
      }),
    );

    await fetchTimeline({ limit: 10, offset: 20 });

    expect(url?.pathname).toBe("/me/timeline");
    expect(url?.searchParams.get("limit")).toBe("10");
    expect(url?.searchParams.get("offset")).toBe("20");
  });

  it("returns the grouped feed shape unchanged, so the feed components can render it", async () => {
    // NEU-1351's contract: `/me/timeline` answers exactly as `/feed/grouped` does. Anything
    // that had to be translated here would mean the two surfaces had drifted.
    server.use(
      http.get(`${base}/me/timeline`, () =>
        HttpResponse.json({
          items: [{ film_ref: "a-film", day: "2026-06-23" }],
          total: 1,
          limit: 10,
          offset: 0,
        }),
      ),
    );

    const page = await fetchTimeline({ limit: 10, offset: 0 });

    expect(page).toMatchObject({ total: 1, limit: 10, offset: 0 });
    expect(page.items[0]).toMatchObject({ film_ref: "a-film", day: "2026-06-23" });
  });

  it("surfaces the entitlement 403 as an error the caller can recognise", async () => {
    server.use(
      http.get(`${base}/me/timeline`, () =>
        HttpResponse.json({ detail: "entitlement_required" }, { status: 403 }),
      ),
    );

    await expect(fetchTimeline({ limit: 10, offset: 0 })).rejects.toSatisfy(isEntitlementError);
  });
});

describe("watchlist calendar", () => {
  it("asks for one page of the reader's own calendar by date", async () => {
    let url: URL | undefined;
    server.use(
      http.get(`${base}/me/calendar`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({ items: [], total: 0, limit: 20, offset: 1 });
      }),
    );

    await fetchWatchlistCalendar({ limit: 20, offset: 1 });

    expect(url?.pathname).toBe("/me/calendar");
    expect(url?.searchParams.get("limit")).toBe("20");
    expect(url?.searchParams.get("offset")).toBe("1");
  });

  it("returns the public calendar's shape unchanged, so one component renders both tabs", async () => {
    // NEU-1411's contract: `/me/calendar` answers exactly as `/calendar` does. Anything that
    // had to be translated here would mean the two tabs had drifted.
    server.use(
      http.get(`${base}/me/calendar`, () =>
        HttpResponse.json({
          items: [{ film_ref: "a-film", release_date: "2026-07-04", release_type: "wide" }],
          total: 1,
          limit: 20,
          offset: 0,
        }),
      ),
    );

    const page = await fetchWatchlistCalendar({ limit: 20, offset: 0 });

    expect(page).toMatchObject({ total: 1, limit: 20, offset: 0 });
    expect(page.items[0]).toMatchObject({ film_ref: "a-film", release_date: "2026-07-04" });
  });

  it("caches every page under the watchlist, so a watchlist change refreshes it", () => {
    // `useToggleWatchlist` invalidates `watchlistKey`, which is a prefix match — the calendar refetches with no extra wiring in either mutation, and a
    // re-read of `/me` drops it with the collection it is a view of (D-1412.3).
    expect(watchlistCalendarPageKey(20, 0).slice(0, watchlistKey.length)).toEqual([
      ...watchlistKey,
    ]);
  });
});

describe("useToggleWatchlist — what a want/stop refreshes", () => {
  /** A client whose `invalidateQueries` we can read back, wrapped for `renderHook`. */
  function harness() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
    return { qc, invalidate, wrapper };
  }

  /** The query keys a run invalidated, stringified so `toContain` can compare them by value.
   *  `unknown[]` rather than the spy's own call type: `invalidateQueries` is overloaded, and
   *  the inferred tuple loses the filter argument we are actually reading. */
  const invalidatedKeys = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map((call) => JSON.stringify((call[0] as { queryKey?: unknown }).queryKey));

  it("invalidates the timeline as well as the watchlist, which the old toggle never did", async () => {
    // The one genuinely new line in D-1405.4: a want creates a title follow, and a follow is
    // what `/` is built from — so the home page has to be re-read. The watchlist alone would
    // leave a just-followed film missing from the timeline until something else refetched it.
    server.use(...followGraphHandlers().handlers);
    const { invalidate, wrapper } = harness();
    const { result } = renderHook(() => useToggleWatchlist(), { wrapper });

    result.current.mutate({ film: makeWatchlistItem().film, onList: false });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidatedKeys(invalidate)).toContain(JSON.stringify(timelineKey));
    expect(invalidatedKeys(invalidate)).toContain(JSON.stringify(watchlistKey));
  });

  it("leaves the timeline alone when the request failed", async () => {
    // Invalidation is on success only: a rolled-back toggle leaves the follow graph the
    // timeline was already built from, so re-reading it would fetch the same days.
    server.use(...entitlementRequiredHandlers());
    const { invalidate, wrapper } = harness();
    const { result } = renderHook(() => useToggleWatchlist(), { wrapper });

    result.current.mutate({ film: makeWatchlistItem().film, onList: false });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidatedKeys(invalidate)).not.toContain(JSON.stringify(timelineKey));
  });
});
