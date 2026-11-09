import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { env } from "@/env";
import { makeInvite } from "@/test/msw/invites";
import { createInvite, fetchInvites } from "./invites";

const base = env.apiBaseUrl;

describe("fetchInvites", () => {
  it("returns the list as the backend sends it", async () => {
    const items = [makeInvite({ code: "newer" }), makeInvite({ code: "older" })];
    server.use(http.get(`${base}/admin/invites`, () => HttpResponse.json(items)));
    expect(await fetchInvites()).toEqual(items);
  });
});

describe("createInvite", () => {
  it("POSTs an empty body for an unhinted code", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${base}/admin/invites`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeInvite(), { status: 201 });
      }),
    );
    await createInvite(null);
    expect(body).toEqual({});
  });

  it("sends the hint as email_hint when given one", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${base}/admin/invites`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeInvite({ email_hint: "alice@example.com" }), {
          status: 201,
        });
      }),
    );
    const created = await createInvite("alice@example.com");
    expect(body).toEqual({ email_hint: "alice@example.com" });
    expect(created.email_hint).toBe("alice@example.com");
  });
});
