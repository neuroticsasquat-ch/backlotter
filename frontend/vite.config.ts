import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import path from "node:path";

// Upload source maps + create a Sentry release only when an auth token is present
// (set in Cloudflare Workers Builds). Local/dev builds have no token and skip upload.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

export default defineConfig({
  // "hidden" emits source maps (so the Sentry plugin can upload them) but omits the
  // //# sourceMappingURL= comment — otherwise `wrangler deploy` fails reading a map that
  // filesToDeleteAfterUpload has already removed. Sentry still resolves via debug IDs.
  build: { sourcemap: sentryAuthToken ? "hidden" : false },
  base: "/",
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
    ...(sentryAuthToken
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG ?? "neuroticsasquatch",
            project: process.env.SENTRY_PROJECT ?? "backlotter-frontend",
            authToken: sentryAuthToken,
            release: { name: process.env.VITE_GIT_SHA },
            // Upload maps to Sentry, then delete them from the build output so they
            // aren't served publicly on backlotter.com. Stack-trace resolution still
            // works via the debug IDs embedded in the JS.
            sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
          }),
        ]
      : []),
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
    // the workspace compose; the fallback is the same service on the compose network. Only
    // the browser needs this -- SSR loaders run inside the container and read the absolute
    // `API_BASE_URL` Worker binding from `.dev.vars` instead.
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET ?? "http://api:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
    // No `hmr` block on purpose. Left unset, Vite injects null for protocol, host and
    // port, and the client falls back to the page's own origin -- so the socket follows
    // however the dev server was reached, whether that is the workspace's HTTPS proxy or
    // http://localhost:5173 directly. Pinning them (as this did to the retired Traefik
    // host on :443) breaks every other route in, and breaks it silently: the page still
    // renders and only live reload stops arriving.
    allowedHosts: [".coder.neuroticsasquat.ch"],
    watch: {
      usePolling: true,
      interval: 500,
    },
  },
});
