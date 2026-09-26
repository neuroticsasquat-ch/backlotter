import { createContext, useContext, useSyncExternalStore } from "react";
import type { AuthedUser } from "@/api/types";

/**
 * The timeline hint (NEU-1468, ADR-0001): a first-party cookie on the site origin that says the
 * account last resolved entitled, so `/` can server-render the timeline skeleton instead of the
 * global feed while `/me` is still in flight.
 *
 * It proves nothing and grants nothing. The browser writes it for itself, because the backend's
 * cookies live on the API origin and the Worker cannot see them; the API never reads it. Its
 * value carries nothing — presence is the hint — and a stale one only costs a skeleton-to-feed
 * swap.
 */
export const TIMELINE_HINT_COOKIE = "timeline_hint";

/** The backend's `SESSION_TTL_DAYS` default, so the hint lives about as long as the session it
 *  predicts. Re-stamped on every entitled resolve, so it slides with it too. */
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** The public layout's loader answer, handed down by the layout: what the request's `Cookie`
 *  header said, which is the only thing the server render can know. `undefined` means no public
 *  layout above this component: the SPA subtree, or a test that renders a page on its own.
 *
 *  A context rather than `useRouteLoaderData("routes/public-layout")`: that hook throws outside a
 *  data router, and much of the component tree is tested under a plain `MemoryRouter`. */
export const TimelineHintContext = createContext<boolean | undefined>(undefined);

/** The `Set-Cookie`-style string for `document.cookie`: set for an entitled account, expired for
 *  anyone else. Pure so the attributes can be pinned without a browser's cookie jar. */
export function timelineHintCookie(user: AuthedUser | null, protocol: string): string {
  const value = user?.entitled ? `1; Path=/; Max-Age=${MAX_AGE_SECONDS}` : "; Path=/; Max-Age=0";
  const secure = protocol === "https:" ? "; Secure" : "";
  return `${TIMELINE_HINT_COOKIE}=${value}; SameSite=Lax${secure}`;
}

/** Records what the account just resolved to. Call it only with a *resolved* account — an
 *  answered `/me`, a login, a signup, a logout — never from a pending or failed read. */
export function writeTimelineHint(user: AuthedUser | null): void {
  if (typeof document === "undefined") return;
  document.cookie = timelineHintCookie(user, window.location.protocol);
}

/** Drops the hint whatever the account is; the logout path. */
export function clearTimelineHint(): void {
  writeTimelineHint(null);
}

/** Whether a `Cookie` header (or `document.cookie`, which has the same shape) carries the hint. */
export function readTimelineHint(cookies: string | null | undefined): boolean {
  if (!cookies) return false;
  return cookies.split(";").some((pair) => pair.trim().split("=")[0] === TIMELINE_HINT_COOKIE);
}

/** Cookie writes raise no event. Nothing needs one: the hint only matters while `["me"]` is in
 *  flight, and every write happens where that query settles, which re-renders its readers. */
const noSubscription = () => () => {};

/**
 * Whether the hint is present.
 *
 * On the server and during hydration it is the layout loader's answer, so the server render and
 * the first client paint read the same value and cannot mismatch. From then on it is the
 * browser's own jar, read live: a hint the account has since cleared — a 401, an unentitled
 * answer — must not come back from a loader snapshot the next time `["me"]` is re-read
 * (D-1468.4). Outside the public layout (the SPA subtree, client-only behind a null
 * `HydrateFallback`) nothing is hydrated, so it is the jar throughout.
 */
export function useTimelineHint(): boolean {
  const fromLoader = useContext(TimelineHintContext);
  return useSyncExternalStore(
    noSubscription,
    () => readTimelineHint(document.cookie),
    () => fromLoader ?? false,
  );
}
