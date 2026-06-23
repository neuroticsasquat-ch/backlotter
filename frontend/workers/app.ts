import { createRequestHandler } from "react-router";

// Context wiring via RouterContextProvider (v8 API) lands with the first SSR
// loader that needs cloudflare env (NEU-310). The skeleton /preview route has
// no backend calls, so context is omitted here for now.
const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext) {
    return requestHandler(request);
  },
} satisfies ExportedHandler<Env>;
