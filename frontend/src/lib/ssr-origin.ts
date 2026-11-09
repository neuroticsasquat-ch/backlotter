import type { AppEnv } from "@/lib/load-context";

/** Marks a request as coming from our Worker: its value is the shared `SSR_ORIGIN_SECRET`,
 *  which the backend compares in constant time (backend NEU-1344 §4). */
export const SSR_ORIGIN_HEADER = "X-Backlotter-Origin";

/** The visitor's IP, which the backend rate limiter keys on instead of the Worker's egress IP. */
export const SSR_CLIENT_IP_HEADER = "X-Backlotter-Client-IP";

/** One warning per isolate is enough — a Worker signs every SSR request it serves. */
let warnedUnsigned = false;

/**
 * Headers an SSR loader fetch sends so the backend's per-IP rate limiter keys on the visitor
 * rather than on Cloudflare's egress IPs, which every SSR request would otherwise share
 * (backend NEU-1344 §4).
 *
 * Deliberately a dedicated header and **not** `X-Forwarded-For`: Traefik strips forwarded
 * headers from senders outside its trusted set, and the Worker's egress IPs are not in it, so
 * an `X-Forwarded-For` from here would never survive the hop.
 *
 * Returns `{}` when `SSR_ORIGIN_SECRET` is unset (local dev, tests, and the window between the
 * backend deploy and the secret being set — see the rollout order in NEU-1344 §5); unsigned
 * requests are limited on the socket address, never rejected. If `CF-Connecting-IP` is missing
 * the request is still signed and the backend falls back to the egress IP.
 *
 * Browser-side fetches never call this — they already arrive with the visitor's own IP.
 */
export function ssrOriginHeaders(env: AppEnv, request: Request): Record<string, string> {
  const secret = env.SSR_ORIGIN_SECRET;
  if (!secret) {
    // Unset is fine locally and in tests. In a deployed Worker it is not: every SSR read then
    // keys on the handful of Cloudflare egress IPs, so once the backend's public bucket is
    // enabled the whole site 429s and reads as a backend outage. Say so once per isolate
    // (`observability` is on in wrangler.jsonc) rather than failing silently — the same
    // "a failure someone can read" rule as the empty Turnstile key in `src/env.ts`.
    if (import.meta.env.PROD && !warnedUnsigned) {
      warnedUnsigned = true;
      console.warn(
        "SSR_ORIGIN_SECRET is not set; SSR fetches are unsigned and the backend will rate-limit " +
          "them on the Worker's egress IP. Run `wrangler secret put SSR_ORIGIN_SECRET`.",
      );
    }
    return {};
  }
  const clientIp = request.headers.get("CF-Connecting-IP");
  return clientIp
    ? { [SSR_ORIGIN_HEADER]: secret, [SSR_CLIENT_IP_HEADER]: clientIp }
    : { [SSR_ORIGIN_HEADER]: secret };
}
