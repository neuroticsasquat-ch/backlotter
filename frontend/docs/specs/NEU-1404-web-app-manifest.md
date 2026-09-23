# NEU-1404 — Web app manifest, install icons, and Apple standalone metas

**Ticket:** [NEU-1404](https://linear.app/neuroticsasquatch/issue/NEU-1404/web-app-manifest-install-icons-and-apple-standalone-metas)
**Parent story:** NEU-1337 · **Milestone:** M7 — Notifications, digest, and calendar
**Decision:** D-36 (`../backend/docs/specs/bl-consumer-pivot-project-spec.md` §5 Delivery)
**Target repo:** upcoming-movies-frontend · **Base branch:** `release/v1.0.0` (AGENTS.md `loop_base`)
**Blocks:** NEU-1388 (service worker and push subscribe toggle) — its iOS branch is unreachable until this ships
**Blocked by:** nothing

## What to build and why

D-36 ships Web Push last and says iOS "requires home-screen install; documented, not worked
around". Today the home-screen route does not exist to document: `public/` holds only
`favicon.ico`, `favicon.svg` and a 180×180 `apple-touch-icon.png`, and the `Layout` head in
`src/root.tsx` links no manifest. Without a manifest declaring `display: "standalone"`, Add to
Home Screen on iOS produces a Safari bookmark, `PushManager` never appears, and every iOS user
lands permanently in NEU-1388's "not installed" branch. Android push works from an ordinary Chrome
tab without any of this; the manifest buys Android installability plus a proper notification
identity (icon and status-bar badge), and buys iOS the feature at all.

This ticket makes the site installable and nothing more: one manifest, one icon set rendered
from the existing logo, five head tags. No service worker, no toggle, no push code — those are
NEU-1388.

Static assets already resolve ahead of the SSR Worker: the built `dist/server/wrangler.json`
carries `"assets": {"directory": "../client"}` and `run_worker_first` is unset, so
`/manifest.webmanifest` and `/icons/*` are served by Cloudflare's asset layer with no Wrangler
change.

## Key decisions

### D-1404.1 — Icons are committed PNGs rendered by a checked-in script

`scripts/icons.mjs` reads `public/favicon.svg`, the single source of the logo, and writes every
raster icon with `sharp`. It is run by hand inside the container (`task shell`, then
`pnpm icons`) whenever the logo changes, and its outputs are committed. There is no build-time
generation: the assets change rarely, and a native image binary in Cloudflare Workers Builds is
a deploy risk for no benefit.

`sharp` is present in the lockfile at 0.35.2 but only as miniflare's private dependency, so it
does **not** resolve from a repo script under pnpm's strict layout (verified in the `web`
container: `Cannot find package 'sharp'`). Add it explicitly with
`task deps:add-dev -- sharp@0.35.2`, then `task build` once so the volume picks it up. Same
version as the lockfile, so no second copy is downloaded.

Add `"icons": "node scripts/icons.mjs"` to `package.json` scripts. The script is plain ESM
JavaScript because the repo has no TypeScript runner outside Vite.

Chosen over: build-time generation (native dependency in the deploy path, slower deploys) and
hand-exported PNGs (the maskable safe zone and the monochrome badge have geometry rules nothing in
the repo would record).

### D-1404.2 — Install icons keep the light tile; the dark palette shows only in the chrome

Every install icon reuses the existing artwork: `#fafaf9` tile, `#0f172a` "bl" glyph. This keeps
the home-screen icon identical in spirit to the favicon and the Apple touch icon users already
have. The app's dark palette appears in `theme_color`, `background_color`, the Android splash and
the iOS status bar, not in the icon.

Chosen over: re-brand to a dark tile (widens the ticket to regenerating every icon), and a split
light-install / dark-notification pair (two artworks for one glyph).

### D-1404.3 — Status bar style is `black`

`apple-mobile-web-app-status-bar-style` is `black`: an opaque bar nearest the `#0f172a`
background, with no layout change. `black-translucent` would run the page under the clock and
notch and needs `viewport-fit=cover` plus safe-area padding on the header, which is layout work
outside this ticket. `default` renders light above a navy header.

### D-1404.4 — The iPhone check gates the merge, on a Wrangler preview URL

Chrome's installability panel proves the manifest; it proves nothing about iOS, and the iCal feed
(NEU-1383) already shipped validated against a parser and never a real client. Before merge, build
the branch and run `pnpm exec wrangler versions upload` from the container to get a
`*.workers.dev` preview URL, open it on a real iPhone, complete the checklist below, and record
the outcome in the PR description. Production is untouched until the release ships.

Prerequisites the implementer must confirm rather than assume: `CLOUDFLARE_API_TOKEN` (or a
`wrangler login`) is available in the container, and preview URLs are enabled for the
`upcoming-movies-frontend` Worker in the Cloudflare dashboard. `start_url` and `scope` are
root-relative, so the manifest validates unchanged on the preview origin.

## Deliverables

### `public/manifest.webmanifest`

```json
{
  "id": "/",
  "name": "backlotter",
  "short_name": "backlotter",
  "description": "Track upcoming movies: release dates, casting, trailers, and a chronological update log for every film.",
  "lang": "en",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "theme_color": "#0f172a",
  "background_color": "#0f172a",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    {
      "src": "/icons/icon-512-maskable.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

- `name` and `short_name` match `SITE_NAME` in `src/lib/seo.ts`; `description` matches its
  `DEFAULT_DESCRIPTION`. Keep the strings literal in the JSON — the manifest is a static asset and
  cannot import them — and note the coupling in a comment beside the constants.
- `theme_color` / `background_color` are `#0f172a`, the hex of `--color-background`
  (`hsl(222 47% 11%)`) in `src/styles/globals.css`.
- `purpose: "maskable"` lives on its own icon entry; never combine `"any maskable"` on one file,
  because the safe-zone padding that makes an icon maskable makes it look small as a plain icon.
- `id` is explicit so a later `start_url` change (for example a signed-in landing) does not
  re-identify the app and orphan existing installs.

### `public/icons/` (all written by `scripts/icons.mjs`)

| File | Size | Content |
|---|---|---|
| `icon-192.png` | 192×192 | `favicon.svg` as-is: rounded light tile, dark glyph, transparent corners |
| `icon-512.png` | 512×512 | same, at 512 |
| `icon-512-maskable.png` | 512×512 | full-bleed light tile with **no** rounded corners, glyph unchanged in position |
| `badge-96.png` | 96×96 | the glyph paths alone, filled `#ffffff` on a transparent canvas, scaled to fit with a margin |

`public/apple-touch-icon.png` (180×180, square light tile) is regenerated by the same script so
every raster icon has one source; it stays at its current path and dimensions.

Geometry notes for the script:

- The maskable safe zone is the central circle of 80% diameter (204.8px radius at 512). The
  favicon's glyph occupies roughly x 15–49, y 20–44 of the 64-unit viewBox, which scales to a
  bounding box about 272×192 centred on the canvas: its corners sit about 166px from centre, well
  inside the safe zone. So "maskable" is the favicon with `rx="0"` on the background rect and
  nothing else moved. Do not shrink the glyph further.
- The badge must be monochrome and alpha-only; Android tints it to the status-bar colour and
  ignores colour information. No tile.
- `icon-192.png` doubles as NEU-1388's `showNotification` icon; `badge-96.png` is its `badge`.
  Both paths are part of this ticket's contract with NEU-1388, so do not rename them later
  without updating that ticket.
- Derive the variants by transforming the SVG text (the background `rx`, or dropping the rect and
  recolouring the glyph fill), then rasterise with `sharp(Buffer.from(svg)).resize(n, n).png()`.
  Keep the transforms in the script, not as hand-edited SVG copies.

### `src/root.tsx` head

Add, beside the existing icon links inside `Layout`:

```tsx
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#0f172a" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black" />
<meta name="apple-mobile-web-app-title" content="backlotter" />
```

`theme-color` is not in the ticket text but is the same head and the same value; Chrome's install
banner and Android's task switcher read it. The three Apple metas are redundant with the manifest
on iOS 16.4+ and belt-and-braces below it. No `crossorigin` on the manifest link: it is
same-origin and needs no cookies.

### Tests

1. **Manifest integrity** — `src/lib/manifest.test.ts` (vitest only picks up `src/**/*.test.*`).
   Read `public/manifest.webmanifest` with `node:fs`, `JSON.parse` it, and assert:
   `display === "standalone"`, `start_url === "/"`, `scope === "/"`, `id === "/"`,
   `theme_color` and `background_color` are `#0f172a`, exactly one icon has
   `purpose: "maskable"`, and for every `icons[]` entry the file at `public/<src>` exists and its
   PNG IHDR width/height equal the declared `sizes`. Read the IHDR directly from the file's first
   24 bytes; do not import `sharp` in tests. Also assert `public/icons/badge-96.png` exists at
   96×96 even though the manifest does not list it, because NEU-1388 depends on it.
2. **Head tags** — extend `src/root.test.tsx`. `Layout` renders `<html>`, which jsdom will not
   nest under a container, and `<Meta />`/`<Links />` need router context. Render it to a string
   instead: extend the existing `vi.mock("react-router", …)` to stub `Meta` and `Links` to
   `() => null`, then `renderToStaticMarkup(<Layout><div /></Layout>)` from `react-dom/server`
   and assert the markup contains `rel="manifest"`, `href="/manifest.webmanifest"`,
   `name="theme-color"`, and the three `apple-mobile-web-app-*` metas with their values.

Both tests run under `task test`. `task lint`, `task typecheck` and prettier stay green;
`scripts/` is outside `oxlint src`, so format it with prettier by hand.

## Acceptance criteria

- `task test`, `task lint`, `task typecheck` green; changed files prettier-formatted.
- `task build:app` succeeds and `dist/client/manifest.webmanifest` plus `dist/client/icons/*`
  are present in the output.
- In Chrome desktop against the built app (or the preview URL), DevTools → Application → Manifest
  shows no installability errors or warnings, and the install affordance appears in the omnibox.
- On the preview URL, `curl -sI …/manifest.webmanifest` returns 200 with
  `content-type: application/manifest+json`. If Cloudflare serves another type, add a
  `public/_headers` rule for that path rather than renaming the file.
- **Real iPhone, on the preview URL, recorded in the PR before merge:**
  - Share → Add to Home Screen shows "backlotter" and the light-tile icon, not a Safari bookmark
    icon.
  - Launching from the Home Screen opens with no Safari chrome; the status bar is black.
  - In that window, `matchMedia('(display-mode: standalone)').matches` is `true` and
    `navigator.standalone` is `true` (check via Safari's Web Inspector, or a temporary console
    log the implementer removes before the PR).
  - Signing in inside the installed app works and the session persists across a relaunch.
  - **TMDB connect from inside the installed app** (`/welcome`, connect flow): note what happens
    on the return leg, since iOS opens out-of-scope origins in an in-app sheet and the return
    behaviour to the app is version-dependent. Record the result; fixing it is out of scope.
- Android Chrome (any device or emulator, if available): the install prompt offers the app and
  the launcher icon is the maskable variant with no letterboxing. Nice to have, not gating.

## Out of scope / deferred

- `public/sw.js`, push subscription, the settings toggle, and the iOS install-funnel copy — all
  NEU-1388, which consumes `/icons/icon-192.png` and `/icons/badge-96.png` from here.
- `black-translucent` status bar and safe-area padding — a separate layout ticket if ever wanted.
- A dark-tile icon re-brand — rejected in D-1404.2.
- Any change to `start_url` for signed-in users. `/` already renders the timeline for a signed-in
  visitor via `TimelineOrFeed`, so a distinct start route is not needed; `id` is pinned so it can
  change later without orphaning installs.
- Fixing the TMDB return leg in standalone mode, if the device check shows it misbehaves. Ticket
  it with the observed behaviour.
- Screenshots, `shortcuts`, `categories`, `related_applications` and other optional manifest
  members. Add only when a concrete surface needs them.
