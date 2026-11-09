import type { RouterContextProvider } from "react-router";
import { getFeedGrouped } from "@/api/public";
import { cloudflareContext } from "@/lib/load-context";
import { ssrOriginHeaders } from "@/lib/ssr-origin";

// How many days the feed shows per page. "View more" fetches the next page of days
// (manual — never auto-loads — so the footer stays reachable). Shared by the global feed and
// the timeline so "View more" means the same span of days on both.
export const DAYS_PER_PAGE = 10;

/** The loader `/` and `/feed` share (NEU-1354). Both SSR the same first page of the global
 *  grouped feed from the same signed fetch; they differ only in the heading and, on `/`, in
 *  what the client island does with the result afterwards. */
export async function loadGlobalFeed({
  request,
  context,
}: {
  request: Request;
  context: Readonly<RouterContextProvider>;
}) {
  const { env } = context.get(cloudflareContext);
  const feed = await getFeedGrouped(env.API_BASE_URL, {
    limit: DAYS_PER_PAGE,
    headers: ssrOriginHeaders(env, request),
  });
  return { feed };
}
