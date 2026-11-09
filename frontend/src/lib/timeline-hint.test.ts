import { afterEach, describe, expect, it } from "vitest";
import type { AuthedUser } from "@/api/types";
import {
  TIMELINE_HINT_COOKIE,
  clearTimelineHint,
  readTimelineHint,
  timelineHintCookie,
  writeTimelineHint,
} from "@/lib/timeline-hint";

const user = (entitled: boolean) => ({ entitled }) as AuthedUser;

afterEach(() => clearTimelineHint());

describe("timelineHintCookie", () => {
  it("sets a 30-day, site-wide, Lax cookie for an entitled user", () => {
    expect(timelineHintCookie(user(true), "http:")).toBe(
      "timeline_hint=1; Path=/; Max-Age=2592000; SameSite=Lax",
    );
  });

  it("adds Secure on https", () => {
    expect(timelineHintCookie(user(true), "https:")).toBe(
      "timeline_hint=1; Path=/; Max-Age=2592000; SameSite=Lax; Secure",
    );
  });

  it("expires it for an unentitled user and for no user", () => {
    for (const who of [user(false), null]) {
      expect(timelineHintCookie(who, "https:")).toBe(
        "timeline_hint=; Path=/; Max-Age=0; SameSite=Lax; Secure",
      );
    }
  });
});

describe("writeTimelineHint", () => {
  it("writes the cookie for an entitled user and clears it otherwise", () => {
    writeTimelineHint(user(true));
    expect(readTimelineHint(document.cookie)).toBe(true);
    writeTimelineHint(user(false));
    expect(readTimelineHint(document.cookie)).toBe(false);
    writeTimelineHint(user(true));
    writeTimelineHint(null);
    expect(readTimelineHint(document.cookie)).toBe(false);
  });
});

describe("readTimelineHint", () => {
  it("answers true only when the cookie is present", () => {
    expect(readTimelineHint(`${TIMELINE_HINT_COOKIE}=1`)).toBe(true);
    expect(readTimelineHint(`session=abc; ${TIMELINE_HINT_COOKIE}=1; theme=dark`)).toBe(true);
    expect(readTimelineHint("session=abc")).toBe(false);
    expect(readTimelineHint(`not_${TIMELINE_HINT_COOKIE}=1`)).toBe(false);
    expect(readTimelineHint("")).toBe(false);
    expect(readTimelineHint(null)).toBe(false);
  });
});
