import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import path from "node:path";

// Upload source maps to Bugsink only when an auth token is present (set in Cloudflare Workers
// Builds). Without one the build still succeeds: it emits no maps and skips the upload, with a
// warning at build time (NEU-1594).
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

// The deployed commit (NEU-1594): an explicit VITE_GIT_SHA, else Workers Builds'
// WORKERS_CI_COMMIT_SHA, else Pages' CF_PAGES_COMMIT_SHA, else Coolify's SOURCE_COMMIT — which is
// the literal "unknown" unless "Include SOURCE_COMMIT in build" is on, so that one is not a SHA.
// Becomes the release on the upload and on both the browser and the Worker init (`lib/sentry.ts`).
const gitSha = [
  process.env.VITE_GIT_SHA,
  process.env.WORKERS_CI_COMMIT_SHA,
  process.env.CF_PAGES_COMMIT_SHA,
  process.env.SOURCE_COMMIT,
].find((sha) => sha && sha !== "unknown");

// Logs that a build without a token skipped the source map upload (NEU-1594).
function warnSkippedUpload(): Plugin {
  return {
    name: "backlotter-warn-skipped-upload",
    apply: "build",
    buildStart() {
      this.warn("SENTRY_AUTH_TOKEN is not set: skipping the source map upload to Bugsink.");
    },
  };
}

export default defineConfig({
  // Read by `lib/sentry.ts` in both the client and the Worker bundle, so they share one release.
  define: gitSha ? { __GIT_SHA__: JSON.stringify(gitSha) } : {},
  // "hidden" emits source maps (so the Sentry plugin can upload them) but omits the
  // //# sourceMappingURL= comment — otherwise `wrangler deploy` fails reading a map that
  // filesToDeleteAfterUpload has already removed. Bugsink resolves via debug IDs.
  build: { sourcemap: sentryAuthToken ? "hidden" : false },
  base: "/",
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
    ...(sentryAuthToken
      ? [
          // Bugsink speaks Sentry's artifact-bundle upload but not its releases API, so (as in
          // Bugsink's Vite guide) the release is only injected into the bundle, never created or
          // finalized. Maps match events by the debug IDs the plugin injects by default.
          sentryVitePlugin({
            url: process.env.SENTRY_URL,
            // Bugsink has no orgs, but the plugin skips the upload without one; this is the
            // placeholder Bugsink's own docs pass.
            org: process.env.SENTRY_ORG ?? "bugsinkhasnoorgs",
            project: process.env.SENTRY_PROJECT ?? "upcoming-movies-frontend",
            authToken: sentryAuthToken,
            release: { name: gitSha, create: false, finalize: false, inject: true },
            // Upload the maps, then delete them from the build output so they aren't served
            // publicly on backlotter.com.
            sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
            // The plugin reports its own usage to sentry.io by default; nothing here uses Sentry.
            telemetry: false,
          }),
        ]
      : [warnSkippedUpload()]),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // The browser reaches the API through this dev server rather than directly, so dev is
    // same-origin: the session cookie and the CSRF header behave as they do in prod, and no
    // CORS config has to be kept in sync. `API_PROXY_TARGET` is handed to this container by
    // docker-compose.yml; the fallback is the backend's compose service on the shared
    // `proxy` network. Only the browser needs this -- SSR loaders run inside the container
    // and read the absolute `API_BASE_URL` Worker binding from `.dev.vars` instead.
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET ?? "http://upmovies-backend:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
    // No `hmr` block on purpose. Left unset, Vite injects null for protocol, host and
    // port, and the client falls back to the page's own origin -- so the socket follows
    // however the dev server was reached, which through Traefik is wss on :443. Pinning
    // them breaks every other route in, and breaks it silently: the page still renders and
    // only live reload stops arriving.
    allowedHosts: ["app.upmovies.localhost"],
    watch: {
      usePolling: true,
      interval: 500,
      // pnpm in the container keeps its store at /app/.pnpm-store (the bind mount's root),
      // and polling its ~50k files kept the dev server from ever listening.
      ignored: ["**/.pnpm-store/**", "**/.wrangler/**"],
    },
  },
});
