import { createContext } from "react-router";

/** The subset of Cloudflare Worker env that SSR loaders read. Kept minimal so this
 *  module references no Worker-only globals (`Env`/`ExecutionContext`) and type-checks
 *  under the client tsconfig. `workers/app.ts` maps the real `Env` into it. */
export interface AppEnv {
  API_BASE_URL: string;
  /** Shared secret that identifies a loader fetch to the backend rate limiter (NEU-1344 §4).
   *  A Wrangler secret, so it is absent locally and in tests — see `lib/ssr-origin.ts`. */
  SSR_ORIGIN_SECRET?: string;
}

/** Worker env exposed to SSR loaders via the request context (set in `workers/app.ts`). */
export const cloudflareContext = createContext<{ env: AppEnv }>();
