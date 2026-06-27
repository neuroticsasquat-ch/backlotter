import { createRequestHandler, RouterContextProvider } from "react-router";
import * as Sentry from "@sentry/cloudflare";
import { cloudflareContext } from "@/lib/load-context";
import { SENTRY_TUNNEL_PATH, sentryTunnelUpstream } from "@/lib/sentry-tunnel";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

// Proxy a browser Sentry envelope on to the ingest endpoint (the `tunnel` target set in
// entry.client.tsx). Same-origin so ad blockers don't drop it; validated against our own
// DSN so it can't be used as an open relay.
async function handleSentryTunnel(request: Request, dsn: string): Promise<Response> {
  const body = await request.text();
  const newline = body.indexOf("\n");
  const envelopeHeader = newline === -1 ? body : body.slice(0, newline);
  const upstream = sentryTunnelUpstream(dsn, envelopeHeader);
  if (!upstream) return new Response("invalid envelope", { status: 400 });
  return fetch(upstream, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-sentry-envelope" },
  });
}

const handler = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    if (request.method === "POST" && new URL(request.url).pathname === SENTRY_TUNNEL_PATH) {
      return handleSentryTunnel(request, env.SENTRY_DSN);
    }
    const context = new RouterContextProvider();
    context.set(cloudflareContext, { env });
    return requestHandler(request, context);
  },
} satisfies ExportedHandler<Env>;

// Wrap the SSR fetch handler so server-side loader/render errors are reported.
// DSN comes from the Worker env (set as a wrangler var / CF dashboard); empty → disabled.
export default Sentry.withSentry(
  (env: Env) => ({
    dsn: env.SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_GIT_SHA,
    tracesSampleRate: 0.1,
  }),
  handler,
);
