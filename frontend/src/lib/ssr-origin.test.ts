import { describe, expect, it } from "vitest";
import { SSR_CLIENT_IP_HEADER, SSR_ORIGIN_HEADER, ssrOriginHeaders } from "@/lib/ssr-origin";

const SECRET = "s3cret";

function request(headers: Record<string, string> = {}) {
  return new Request("https://backlotter.com/feed", { headers });
}

describe("ssrOriginHeaders", () => {
  it("signs the request and forwards the visitor IP", () => {
    const headers = ssrOriginHeaders(
      { API_BASE_URL: "https://api.backlotter.com", SSR_ORIGIN_SECRET: SECRET },
      request({ "CF-Connecting-IP": "203.0.113.7" }),
    );
    expect(headers).toEqual({
      [SSR_ORIGIN_HEADER]: SECRET,
      [SSR_CLIENT_IP_HEADER]: "203.0.113.7",
    });
  });

  it("sends nothing when the secret is unset", () => {
    const headers = ssrOriginHeaders(
      { API_BASE_URL: "https://api.backlotter.com" },
      request({ "CF-Connecting-IP": "203.0.113.7" }),
    );
    expect(headers).toEqual({});
  });

  it("still signs when CF-Connecting-IP is missing, so the backend keys on the egress IP", () => {
    const headers = ssrOriginHeaders(
      { API_BASE_URL: "https://api.backlotter.com", SSR_ORIGIN_SECRET: SECRET },
      request(),
    );
    expect(headers).toEqual({ [SSR_ORIGIN_HEADER]: SECRET });
  });

  it("never reads X-Forwarded-For — Traefik strips it from untrusted senders", () => {
    const headers = ssrOriginHeaders(
      { API_BASE_URL: "https://api.backlotter.com", SSR_ORIGIN_SECRET: SECRET },
      request({ "X-Forwarded-For": "203.0.113.7" }),
    );
    expect(headers[SSR_CLIENT_IP_HEADER]).toBeUndefined();
  });
});
