import type { EntryContext, HandleErrorFunction } from "react-router";
import { isRouteErrorResponse, ServerRouter } from "react-router";
import * as Sentry from "@sentry/cloudflare";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  let shellRendered = false;
  const userAgent = request.headers.get("user-agent");

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      onError(error: unknown) {
        responseStatusCode = 500;
        // Log streaming rendering errors from inside the shell.  Don't log
        // errors encountered during initial shell rendering since they'll
        // reject and get logged in handleDocumentRequest.
        if (shellRendered) {
          console.error(error);
        }
      },
    },
  );
  shellRendered = true;

  // Ensure requests from bots and SPA Mode renders wait for all content to load before responding
  // https://react.dev/reference/react-dom/server/renderToPipeableStream#waiting-for-all-content-to-load-for-crawlers-and-static-generation
  if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}

/**
 * Report the loader, action and render errors React Router catches on the server (NEU-2273).
 *
 * Without this export React Router only logs them, and the public routes' ErrorBoundaries
 * report nothing either, so a failed SSR loader never reached Bugsink. It runs inside the
 * Worker's `withSentry` scope (`workers/app.ts`), so the event carries that request.
 *
 * Logged but not reported: an error response, which is either one a route threw on purpose (a
 * 404, a redirect, the busy 503 `lib/overload.ts` makes of the API's overload answer) or React
 * Router's own for a URL nothing serves (404, 405), whose inner error its default handler logs.
 * Neither logged nor reported: an aborted request, as in the default handler; the visitor left.
 */
export const handleError: HandleErrorFunction = (error, { request }) => {
  if (request.signal.aborted) return;
  if (isRouteErrorResponse(error)) {
    const inner = (error as { error?: unknown }).error;
    if (inner) console.error(inner);
    return;
  }
  console.error(error);
  Sentry.captureException(error);
};
