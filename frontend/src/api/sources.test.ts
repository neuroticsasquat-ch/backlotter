import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { env } from "@/env";
import type { SourceDomain } from "@/api/types";
import { effectiveTier, fetchSources, setSourceOverride } from "./sources";

const base = env.apiBaseUrl;

function makeSource(overrides: Partial<SourceDomain> = {}): SourceDomain {
  return {
    domain: "example.com",
    llm_tier: "acceptable",
    llm_reason: "Regional outlet.",
    admin_override: "none",
    updated_at: "2026-07-01T12:00:00Z",
    ...overrides,
  };
}

describe("sources api", () => {
  it("fetchSources returns the typed list", async () => {
    server.use(
      http.get(`${base}/admin/sources`, () =>
        HttpResponse.json([makeSource({ domain: "variety.com", llm_tier: "trusted" })]),
      ),
    );
    const rows = await fetchSources();
    expect(rows).toHaveLength(1);
    expect(rows[0].domain).toBe("variety.com");
    expect(rows[0].llm_tier).toBe("trusted");
  });

  it("setSourceOverride POSTs the override to the domain-scoped path", async () => {
    let seenUrl = "";
    let seenBody: unknown = null;
    server.use(
      http.post(`${base}/admin/sources/mshale.com/override`, async ({ request }) => {
        seenUrl = request.url;
        seenBody = await request.json();
        return HttpResponse.json(makeSource({ domain: "mshale.com", admin_override: "block" }));
      }),
    );
    const row = await setSourceOverride("mshale.com", "block");
    expect(new URL(seenUrl).pathname).toBe("/admin/sources/mshale.com/override");
    expect(seenBody).toEqual({ override: "block" });
    expect(row.admin_override).toBe("block");
  });

  describe("effectiveTier", () => {
    it("returns 'blocked' when admin_override is block", () => {
      expect(effectiveTier(makeSource({ admin_override: "block", llm_tier: "trusted" }))).toBe(
        "blocked",
      );
    });
    it("maps trust -> trusted and allow -> acceptable", () => {
      expect(effectiveTier(makeSource({ admin_override: "trust", llm_tier: "low" }))).toBe("trusted");
      expect(effectiveTier(makeSource({ admin_override: "allow", llm_tier: "low" }))).toBe(
        "acceptable",
      );
    });
    it("falls back to the llm_tier when there is no override", () => {
      expect(effectiveTier(makeSource({ admin_override: "none", llm_tier: "low" }))).toBe("low");
      expect(effectiveTier(makeSource({ admin_override: "none", llm_tier: null }))).toBeNull();
    });
  });
});
