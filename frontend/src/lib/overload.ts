import { data, type HeadersArgs, isRouteErrorResponse } from "react-router";
import { ApiOverloadedError } from "@/api/public";

/**
 * Run a public loader, turning the API's overload answer (`ApiOverloadedError`, NEU-2271) into
 * a thrown 503 the route's ErrorBoundary renders as the busy page (NEU-2273).
 *
 * Thrown as route data rather than left as an error, for three reasons: the document goes out
 * as a 503 with the API's `Retry-After` rather than a 500, the boundary can tell it apart on the
 * client too (a thrown `Error` reaches the browser sanitised to "Unexpected Server Error"), and
 * React Router does not pass a thrown response to `handleError`, so it is never reported.
 *
 * Deliberately no retry here: retrying holds the Worker request open through the very burst the
 * API is shedding.
 */
export async function busyOnOverload<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (!(error instanceof ApiOverloadedError)) throw error;
    throw data(null, {
      status: 503,
      statusText: "Service Unavailable",
      headers: { "Retry-After": String(error.retryAfter) },
    });
  }
}

/** Whether a route boundary's error is the busy 503 {@link busyOnOverload} threw. */
export function isBusy(error: unknown): boolean {
  return isRouteErrorResponse(error) && error.status === 503;
}

/**
 * The `headers` export of every route whose loader runs through {@link busyOnOverload}.
 *
 * React Router copies only cookies from a thrown response's headers onto the document; anything
 * else needs the boundary route's `headers` function. This passes the parent's headers through
 * unchanged, which is what a route with no `headers` export gets, and adds `Retry-After` when the
 * busy 503 set one.
 */
export function busyHeaders({ parentHeaders, errorHeaders }: HeadersArgs): Headers {
  const headers = new Headers(parentHeaders);
  const retryAfter = errorHeaders?.get("Retry-After");
  if (retryAfter) headers.set("Retry-After", retryAfter);
  return headers;
}
