import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { env } from "@/env";
import { deleteEvent, delinkSource, editSummary, resetSummary } from "./moderation";

const BACKEND = env.apiBaseUrl;

describe("moderation api", () => {
  it("POSTs the source url to the event delink endpoint", async () => {
    let received: unknown = null;
    server.use(
      http.post(`${BACKEND}/admin/events/evt-1/delink`, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ delinked: 1, event_removed: true, resummarize_queued: false });
      }),
    );
    const res = await delinkSource("evt-1", "https://x.test/a");
    expect(received).toEqual({ url: "https://x.test/a" });
    expect(res.event_removed).toBe(true);
  });

  it("DELETEs the event", async () => {
    server.use(
      http.delete(`${BACKEND}/admin/events/evt-9`, () =>
        HttpResponse.json({ delinked: 2, event_removed: true, resummarize_queued: false }),
      ),
    );
    const res = await deleteEvent("evt-9");
    expect(res.delinked).toBe(2);
  });

  it("PATCHes the summary text to the edit endpoint", async () => {
    let received: unknown = null;
    server.use(
      http.patch(`${BACKEND}/admin/events/evt-1/summary`, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({
          summary: "New text.",
          edited: true,
          edited_at: "2026-07-06T00:00:00Z",
        });
      }),
    );
    const res = await editSummary("evt-1", "New text.");
    expect(received).toEqual({ summary: "New text." });
    expect(res).toEqual({ summary: "New text.", edited: true, edited_at: "2026-07-06T00:00:00Z" });
  });

  it("DELETEs the summary to reset it to AI", async () => {
    let called = false;
    server.use(
      http.delete(`${BACKEND}/admin/events/evt-1/summary`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await resetSummary("evt-1");
    expect(called).toBe(true);
  });
});
