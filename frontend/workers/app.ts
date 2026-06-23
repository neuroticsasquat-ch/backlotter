import { createRequestHandler, RouterContextProvider } from "react-router";
import { cloudflareContext } from "@/lib/load-context";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const context = new RouterContextProvider();
    context.set(cloudflareContext, { env });
    return requestHandler(request, context);
  },
} satisfies ExportedHandler<Env>;
