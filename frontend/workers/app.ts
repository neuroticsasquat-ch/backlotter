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
//
// Work in raw bytes, not text: replay envelopes carry a binary (compressed) recording
// item, and a UTF-8 round-trip via request.text() would corrupt it (Sentry then rejects
// the envelope with "missing newline after payload"). We decode only the header line
// (ASCII JSON, up to the first newline) for validation and forward the bytes untouched.
async function handleSentryTunnel(request: Request, dsn: string): Promise<Response> {
  const body = await request.arrayBuffer();
  const bytes = new Uint8Array(body);
  const newline = bytes.indexOf(0x0a); // first "\n" — end of the envelope header
  const envelopeHeader = new TextDecoder().decode(
    newline === -1 ? bytes : bytes.subarray(0, newline),
  );
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
