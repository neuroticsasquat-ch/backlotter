import { describe, expect, it } from "vitest";
import type { Invite } from "@/api/types";
import { inviteSignupUrl } from "@/lib/invite-url";

function makeInvite(overrides: Partial<Invite> = {}): Invite {
  return {
    code: "abc123",
    email_hint: null,
    created_at: "2026-09-19T10:00:00Z",
    consumed_at: null,
    consumed_by_user_id: null,
    consumed_by_email: null,
    ...overrides,
  };
}

describe("inviteSignupUrl", () => {
  it("points at the signup page on the given origin with the code as ?invite=", () => {
    expect(inviteSignupUrl(makeInvite(), "https://backlotter.com")).toBe(
      "https://backlotter.com/signup?invite=abc123",
    );
  });

  it("adds &email= when the code is hinted", () => {
    const url = inviteSignupUrl(
      makeInvite({ email_hint: "alice@example.com" }),
      "https://backlotter.com",
    );
    const params = new URL(url).searchParams;
    expect(params.get("invite")).toBe("abc123");
    expect(params.get("email")).toBe("alice@example.com");
  });

  it("encodes a + in the hinted address so it survives the round trip", () => {
    const url = inviteSignupUrl(
      makeInvite({ email_hint: "alice+films@example.com" }),
      "https://backlotter.com",
    );
    expect(url).toContain("email=alice%2Bfilms%40example.com");
    expect(new URL(url).searchParams.get("email")).toBe("alice+films@example.com");
  });

  it("encodes a code with URL-significant characters", () => {
    expect(inviteSignupUrl(makeInvite({ code: "a&b=c" }), "https://backlotter.com")).toBe(
      "https://backlotter.com/signup?invite=a%26b%3Dc",
    );
  });

  it("tolerates a trailing slash on the origin", () => {
    expect(inviteSignupUrl(makeInvite(), "https://backlotter.com/")).toBe(
      "https://backlotter.com/signup?invite=abc123",
    );
  });
});
