import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { env } from "@/env";
import { deleteEvent, delinkSource } from "./moderation";

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
});
