import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { digestPreviewHandler, digestTestSendHandler } from "@/test/msw/admin-digest";
import { env } from "@/env";
import { ApiError, setCsrfToken } from "./client";
import { previewDigest, sendTestDigest, testSendErrorMessage, todayUtc } from "./admin";

const base = env.apiBaseUrl;
const USER = "7f1c3a52-9d1e-4a4b-8e0f-2b6c1d9e4a10";

describe("previewDigest", () => {
  it("sends every control as a query param and answers the HTML part as text", async () => {
    const requests: URLSearchParams[] = [];
    server.use(digestPreviewHandler({ html: "<h1>Your digest</h1>", text: "" }, requests));

    const body = await previewDigest(USER, "weekly", "html", "2026-09-24");

    expect(body).toBe("<h1>Your digest</h1>");
    expect(requests).toHaveLength(1);
    expect(Object.fromEntries(requests[0])).toEqual({
      user_id: USER,
      cadence: "weekly",
      format: "html",
      today: "2026-09-24",
    });
  });

  it("answers the plain-text part untouched", async () => {
    server.use(digestPreviewHandler({ html: "", text: "Your digest\n\n* Dune" }));

    expect(await previewDigest(USER, "daily", "text", "2026-09-24")).toBe("Your digest\n\n* Dune");
  });

  it("throws an ApiError carrying the status for an unknown user", async () => {
    server.use(
      http.get(`${base}/admin/digest/preview`, () =>
        HttpResponse.json({ detail: "user_not_found" }, { status: 404 }),
      ),
    );

    await expect(previewDigest(USER, "daily", "html", "2026-09-24")).rejects.toMatchObject({
      status: 404,
      message: "user_not_found",
    });
  });
});

describe("sendTestDigest", () => {
  it("posts the user, cadence and day with the CSRF header and answers the message id", async () => {
    setCsrfToken("csrf-1");
    let csrf: string | null = null;
    const bodies: unknown[] = [];
    server.use(
      http.post(`${base}/admin/digest/test`, async ({ request }) => {
        csrf = request.headers.get("X-CSRF-Token");
        bodies.push(await request.json());
        return HttpResponse.json({ message_id: "msg-42" }, { status: 202 });
      }),
    );

    const out = await sendTestDigest(USER, "weekly", "2026-09-24");

    expect(out).toEqual({ message_id: "msg-42" });
    expect(csrf).toBe("csrf-1");
    expect(bodies).toEqual([{ user_id: USER, cadence: "weekly", today: "2026-09-24" }]);
    setCsrfToken(null);
  });

  it("works against the default handler shape", async () => {
    server.use(digestTestSendHandler("msg-1"));
    expect(await sendTestDigest(USER, "daily", "2026-09-24")).toEqual({ message_id: "msg-1" });
  });
});

describe("testSendErrorMessage", () => {
  it("says an empty digest sent nothing rather than that the request failed", () => {
    expect(testSendErrorMessage(new ApiError(409, "nothing_to_send", null))).toBe(
      "Nothing to send — no test mail went out.",
    );
  });

  it("blames the provider for a 502", () => {
    expect(testSendErrorMessage(new ApiError(502, "mail_failed", null))).toBe(
      "The mail provider refused the test send.",
    );
  });

  it("falls back to the error's own message", () => {
    expect(testSendErrorMessage(new ApiError(403, "csrf_invalid", null))).toBe("csrf_invalid");
  });
});

describe("todayUtc", () => {
  it("takes the UTC day, not the local one", () => {
    // 23:30 UTC on the 24th is already the 25th east of Greenwich; the slot runs on UTC.
    expect(todayUtc(new Date("2026-09-24T23:30:00Z"))).toBe("2026-09-24");
  });
});
