import { env } from "@/env";

/**
 * The two spellings of one user's calendar feed (D-34).
 *
 * `webcal` is the URL a calendar app is handed: Apple Calendar and Outlook register the scheme
 * and subscribe on a click, and Google's "from URL" field takes it too. It is the same
 * resource as `https` — the scheme is a hint to the OS about which app should open it, not a
 * different endpoint — which is why both are derived from the one API origin rather than
 * configured separately.
 *
 * `https` is kept for the calendar apps that refuse an unknown scheme in a paste field, and
 * because a URL a user can open in a browser is a URL they can check.
 *
 * **Absolute, whatever `VITE_API_BASE_URL` holds.** In production it is an absolute origin
 * (`https://api.backlotter.com`), but in dev it is `/api` — a relative path the Vite dev server
 * proxies (`.env.development`). A relative URL is useless here twice over: there is no scheme
 * for the `webcal:` swap to replace, and what the user copies has to survive being pasted into
 * a calendar app that has never heard of this page. So a relative base is resolved against the
 * page's own origin, which is exactly the origin that proxies it.
 */
export function calendarFeedUrls(token: string): { https: string; webcal: string } {
  const path = `/calendar/${encodeURIComponent(token)}.ics`;
  const base = env.apiBaseUrl.replace(/\/$/, "");
  // `window` is always there in practice — this renders under the client-only SPA subtree —
  // but the module is importable from an SSR route, and a crash is a worse answer than a
  // relative URL nobody is looking at during a server render.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const https = /^https?:/i.test(base) ? `${base}${path}` : `${origin}${base}${path}`;
  return { https, webcal: https.replace(/^https?:/i, "webcal:") };
}
