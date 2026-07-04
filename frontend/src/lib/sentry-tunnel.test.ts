import { describe, expect, it } from "vitest";
import { sentryTunnelUpstream } from "./sentry-tunnel";

const OUR_DSN =
  "https://661cd3047ac9824d9202e4747e983fa8@o4511310598897664.ingest.us.sentry.io/4511638455844864";
const UPSTREAM = "https://o4511310598897664.ingest.us.sentry.io/api/4511638455844864/envelope/";

const header = (dsn: string) => JSON.stringify({ dsn, sent_at: "2026-06-27T00:00:00.000Z" });

describe("sentryTunnelUpstream", () => {
  it("returns the ingest URL for an envelope targeting our project", () => {
    expect(sentryTunnelUpstream(OUR_DSN, header(OUR_DSN))).toBe(UPSTREAM);
  });

  it("rejects an envelope for a different project id (no open relay)", () => {
    const other =
      "https://661cd3047ac9824d9202e4747e983fa8@o4511310598897664.ingest.us.sentry.io/9999999999";
    expect(sentryTunnelUpstream(OUR_DSN, header(other))).toBeNull();
  });

  it("rejects an envelope for a different host", () => {
    const other = "https://abc@o123.ingest.us.sentry.io/4511638455844864";
    expect(sentryTunnelUpstream(OUR_DSN, header(other))).toBeNull();
  });

  it("rejects a header with no dsn", () => {
    expect(sentryTunnelUpstream(OUR_DSN, JSON.stringify({ sent_at: "x" }))).toBeNull();
  });

  it("rejects a non-JSON header", () => {
    expect(sentryTunnelUpstream(OUR_DSN, "not json")).toBeNull();
  });

  it("returns null when our DSN is empty (SSR Sentry disabled)", () => {
    expect(sentryTunnelUpstream("", header(OUR_DSN))).toBeNull();
  });
});
