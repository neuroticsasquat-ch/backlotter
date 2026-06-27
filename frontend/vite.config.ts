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
    hmr: {
      clientPort: 443,
      protocol: "wss",
      host: "app.upmovies.localhost",
    },
    allowedHosts: ["app.upmovies.localhost"],
    watch: {
      usePolling: true,
      interval: 500,
    },
  },
});
