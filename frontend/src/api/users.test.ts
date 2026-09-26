import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { env } from "@/env";
import type { AdminUser } from "./types";
import { entitlementState, fetchAdminUsers, oneYearOut, toExpiryInstant } from "./users";

const base = env.apiBaseUrl;
const NOW = new Date("2026-09-17T12:00:00Z");

function makeUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: "u1",
    email: "alice@example.com",
    is_admin: false,
    email_verified_at: null,
    entitled_until: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("entitlementState", () => {
  it("reads a null expiry as never granted", () => {
    expect(entitlementState(makeUser({ entitled_until: null }), NOW)).toBe("none");
  });

  it("reads a future expiry as active", () => {
    expect(entitlementState(makeUser({ entitled_until: "2027-01-01T00:00:00Z" }), NOW)).toBe(
      "active",
    );
  });

  it("reads a past expiry as expired, not as never granted", () => {
    expect(entitlementState(makeUser({ entitled_until: "2026-01-01T00:00:00Z" }), NOW)).toBe(
      "expired",
    );
  });

  it("treats the exact expiry instant as no longer entitled", () => {
    // Matches the backend rule: entitled iff `entitled_until > now()`, so the boundary is
    // exclusive on both ends of the wire.
    expect(entitlementState(makeUser({ entitled_until: NOW.toISOString() }), NOW)).toBe("expired");
  });
});

describe("fetchAdminUsers", () => {
  it("sends the default page window when given no arguments", async () => {
    let url = "";
    server.use(
      http.get(`${base}/admin/users`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ items: [], total: 0, limit: 50, offset: 0 });
      }),
    );

    await fetchAdminUsers();

    const params = new URL(url).searchParams;
    expect(params.get("limit")).toBe("50");
    expect(params.get("offset")).toBe("0");
    expect(params.has("q")).toBe(false);
  });

  it("omits a blank search rather than sending an empty q", async () => {
    let url = "";
    server.use(
      http.get(`${base}/admin/users`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ items: [], total: 0, limit: 50, offset: 0 });
      }),
    );

    await fetchAdminUsers({ q: "" });

    expect(new URL(url).searchParams.has("q")).toBe(false);
  });

  it("passes a search term and page window through", async () => {
    let url = "";
    server.use(
      http.get(`${base}/admin/users`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ items: [makeUser()], total: 1, limit: 10, offset: 20 });
      }),
    );

    await fetchAdminUsers({ q: "alice", limit: 10, offset: 20 });

    const params = new URL(url).searchParams;
    expect(params.get("q")).toBe("alice");
    expect(params.get("limit")).toBe("10");
    expect(params.get("offset")).toBe("20");
  });
});

describe("oneYearOut", () => {
  it("advances the UTC year and keeps the day", () => {
    expect(oneYearOut(NOW)).toBe("2027-09-17");
  });

  it("does not mutate the date it was given", () => {
    const d = new Date("2026-09-17T12:00:00Z");
    oneYearOut(d);
    expect(d.toISOString()).toBe("2026-09-17T12:00:00.000Z");
  });

  it("rolls a leap day forward to Mar 1 in a non-leap year", () => {
    expect(oneYearOut(new Date("2028-02-29T00:00:00Z"))).toBe("2029-03-01");
  });
});

describe("toExpiryInstant", () => {
  it("runs a grant to the end of the picked day, not its start", () => {
    expect(toExpiryInstant("2027-09-17")).toBe("2027-09-17T23:59:59Z");
  });

  it("leaves the picked day itself still entitled", () => {
    // The backend rule is exclusive (`entitled_until > now()`), so a midnight stamp would
    // make the day the column calls "Access until" read as already expired.
    const expiry = toExpiryInstant("2027-09-17");
    const duringThatDay = new Date("2027-09-17T12:00:00Z");
    expect(entitlementState(makeUser({ entitled_until: expiry }), duringThatDay)).toBe("active");
  });

  it("has lapsed by the next day", () => {
    const expiry = toExpiryInstant("2027-09-17");
    const nextDay = new Date("2027-09-18T00:00:00Z");
    expect(entitlementState(makeUser({ entitled_until: expiry }), nextDay)).toBe("expired");
  });

  it("gives a full year when combined with the picker default", () => {
    const expiry = toExpiryInstant(oneYearOut(NOW));
    const almostAYearLater = new Date("2027-09-17T00:00:00Z");
    expect(entitlementState(makeUser({ entitled_until: expiry }), almostAYearLater)).toBe("active");
  });
});
