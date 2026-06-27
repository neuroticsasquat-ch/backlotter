import { createRequestHandler, RouterContextProvider } from "react-router";
import * as Sentry from "@sentry/cloudflare";
import { cloudflareContext } from "@/lib/load-context";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

const handler = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
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
