import { data, type HeadersArgs, isRouteErrorResponse } from "react-router";
// `@sentry/react`, not `@sentry/cloudflare`, although the loaders run in the Worker: route
// modules import this file for `isBusy` and `busyHeaders`, so it is in the browser bundle too.
// Both SDKs share one `@sentry/core` and its global scope, so the call lands with the Worker's
// client and request, as `root.tsx`'s boundary does during SSR.
import * as Sentry from "@sentry/react";
import { ApiOverloadedError, ApiUnavailableError, DEFAULT_RETRY_AFTER_SECONDS } from "@/api/public";

/**
 * Run a public loader, turning an API that cannot answer into a thrown 503 the route's
 * ErrorBoundary renders as the busy page: its overload answer (`ApiOverloadedError`, NEU-2271,
 * NEU-2273), and a proxy's 502, 503 or 504 when the API is out of rotation
 * (`ApiUnavailableError`, NEU-2284).
 *
 * Thrown as route data rather than left as an error, for three reasons: the document goes out
 * as a 503 with a `Retry-After` rather than a 500, the boundary can tell it apart on the client
 * too (a thrown `Error` reaches the browser sanitised to "Unexpected Server Error"), and React
 * Router does not pass a thrown response to `handleError`. That last one is the point for an
 * overload, which is expected and over in seconds. An unreachable API is an outage, so this
 * reports it itself; `lib/sentry.ts` groups those events into one issue per status.
 *
 * Deliberately no retry here: retrying holds the Worker request open through the very burst the
 * API is shedding.
 */
export async function busyOnOverload<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    let retryAfter: number;
    if (error instanceof ApiOverloadedError) {
      retryAfter = error.retryAfter;
    } else if (error instanceof ApiUnavailableError) {
      Sentry.captureException(error);
      retryAfter = DEFAULT_RETRY_AFTER_SECONDS;
    } else {
      throw error;
    }
    throw data(null, {
      status: 503,
      statusText: "Service Unavailable",
      headers: { "Retry-After": String(retryAfter) },
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
