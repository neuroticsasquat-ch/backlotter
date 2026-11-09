# NEU-307: SEO primitives (meta/OG + robots) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the public-page SEO primitives on the merged NEU-306 SSR foundation: a reusable `buildMeta` head helper, a `/robots.txt`, and a same-origin `/sitemap.xml` that proxies the backend's sitemap — demonstrated on the `/preview` route.

**Architecture:** A pure `src/lib/seo.ts` helper returns React Router `MetaDescriptor[]` (title template, meta description, Open Graph, Twitter, canonical) for route `meta()` exports. `/robots.txt` and `/sitemap.xml` are **resource routes** (loader-only `.ts` modules, no component) registered top-level in `routes.ts`. The sitemap route reads the backend base URL from the Worker env via React Router v8's context API (`createContext` + `RouterContextProvider`), wired in `workers/app.ts` — the first consumer of the `cloudflare.env` load context NEU-306 deferred.

**Tech Stack:** React Router v8 framework mode (`react-router@^8`, `@react-router/dev@^8`), `@cloudflare/vite-plugin@^1.42`, Wrangler v4, Vite 8, Vitest 4 + Testing Library + MSW, TypeScript (strict), Tailwind v4. Runs in the container via `task` (Docker-only — no host Node/pnpm).

**Repo:** `upcoming-movies-frontend` · **Branch:** `tom/neu-307-frontend-seo-primitives-metaog-robots` · **Spec:** `docs/specs/2026-06-23-neu-307-seo-primitives-design.md`

**Blocked by (merged):** NEU-306 (SSR foundation). **Blocks:** NEU-310 (SSR film page), NEU-312 (SSR feed landing) — both consume `buildMeta`.

> **Commit/PR convention (frontend, per repo precedent):** **No per-step commits.** Implement all tasks, run the full gate (`task format` on touched files → `task lint` → `task typecheck` → `task test` → `task build:app`), then **the user commits once** (Conventional Commits + trailing `(NEU-307)`; keep the `🤖 Generated with Claude Code` footer; **no** `Co-Authored-By`) and opens **one** PR. All commands run in the container via `task`; pre-commit hooks delegate into Docker, so commit normally (no `--no-verify`) with the container up. Dependency changes would need `task build` — **this plan adds no dependencies.**

---

## File Structure

**New:**
- `src/lib/seo.ts` — `buildMeta(input): MetaDescriptor[]` head helper + site constants.
- `src/lib/seo.test.ts` — Vitest unit tests for `buildMeta`.
- `src/lib/load-context.ts` — `AppEnv` + `cloudflareContext` (the typed Worker-env context key). **Plain types only** (no Worker globals) so it type-checks under the client `tsconfig.json`.
- `src/routes/robots.ts` — resource route → `GET /robots.txt`.
- `src/routes/robots.test.ts` — Vitest test for the robots loader.
- `src/routes/sitemap.ts` — resource route → `GET /sitemap.xml` (proxies the backend).
- `src/routes/sitemap.test.ts` — Vitest test for the sitemap loader (MSW-mocked backend).

**Modified:**
- `src/env.ts` — add `publicSiteUrl`.
- `src/routes/preview.tsx` — `meta()` now calls `buildMeta`.
- `src/routes/preview.test.tsx` — add a `meta()` head-tags assertion (keep the existing two tests).
- `src/routes.ts` — register the two resource routes at top level.
- `workers/app.ts` — build a `RouterContextProvider`, set `cloudflareContext`, pass it to the request handler.
- `.env`, `.env.example` — add `VITE_PUBLIC_SITE_URL`.

> Why `AppEnv` instead of the generated `Env`: `src/` is type-checked by **both** `tsconfig.json` (client — no Worker types) and `tsconfig.cloudflare.json` (has `@cloudflare/workers-types` + `worker-configuration.d.ts`). A `src/` module that referenced the Worker-only `Env`/`ExecutionContext` types would fail the client typecheck. So the shared context key is typed with a minimal local `AppEnv { API_BASE_URL: string }`; `workers/app.ts` (compiled only by the cloudflare project) maps the real `Env` into it structurally.

---

### Task 1: `buildMeta` SEO helper + site-URL env (TDD)

Goal: a pure helper that produces the head descriptors every public route shares, plus the `publicSiteUrl` env it needs for absolute canonical/`og:url`.

**Files:**
- Create: `src/lib/seo.ts`, `src/lib/seo.test.ts`
- Modify: `src/env.ts`, `.env`, `.env.example`

- [ ] **Step 1: Write the failing test** — `src/lib/seo.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildMeta } from "@/lib/seo";

describe("buildMeta", () => {
  it("templates the title and emits description, OG, Twitter, and canonical", () => {
    const tags = buildMeta({
      title: "The Odyssey",
      description: "Epic seafaring.",
      pathname: "/film/the-odyssey-2026",
    });

    expect(tags).toContainEqual({ title: "The Odyssey · Upcoming Movies Tracker" });
    expect(tags).toContainEqual({ name: "description", content: "Epic seafaring." });
    expect(tags).toContainEqual({
      property: "og:title",
      content: "The Odyssey · Upcoming Movies Tracker",
    });
    expect(tags).toContainEqual({ property: "og:description", content: "Epic seafaring." });
    expect(tags).toContainEqual({ property: "og:type", content: "website" });
    expect(tags).toContainEqual({ property: "og:site_name", content: "Upcoming Movies Tracker" });
    expect(tags).toContainEqual({ name: "twitter:card", content: "summary" });

    const canonical = tags.find((t) => "tagName" in t && t.tagName === "link") as
      | { tagName: "link"; rel: string; href: string }
      | undefined;
    expect(canonical?.rel).toBe("canonical");
    expect(canonical?.href).toMatch(/\/film\/the-odyssey-2026$/);
  });

  it("falls back to the site name and default description when omitted", () => {
    const tags = buildMeta({ pathname: "/" });
    expect(tags).toContainEqual({ title: "Upcoming Movies Tracker" });
    expect(tags.some((t) => "name" in t && t.name === "description")).toBe(true);
    expect(tags.find((t) => "property" in t && t.property === "og:image")).toBeUndefined();
  });

  it("adds image tags and upgrades the Twitter card when an image is given", () => {
    const tags = buildMeta({
      title: "X",
      pathname: "/x",
      image: "https://img.example/poster.jpg",
    });
    expect(tags).toContainEqual({
      property: "og:image",
      content: "https://img.example/poster.jpg",
    });
    expect(tags).toContainEqual({
      name: "twitter:image",
      content: "https://img.example/poster.jpg",
    });
    expect(tags).toContainEqual({ name: "twitter:card", content: "summary_large_image" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- src/lib/seo.test.ts`
Expected: FAIL — cannot resolve `@/lib/seo` (module not created yet).

- [ ] **Step 3: Add `publicSiteUrl` to `src/env.ts`**

Replace the file contents with:

```ts
export const env = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? "https://api.upmovies.localhost",
  publicSiteUrl: import.meta.env.VITE_PUBLIC_SITE_URL ?? "https://app.upmovies.localhost",
} as const;
```

- [ ] **Step 4: Create `src/lib/seo.ts`**

```ts
import type { MetaDescriptor } from "react-router";
import { env } from "@/env";

const SITE_NAME = "Upcoming Movies Tracker";
const DEFAULT_DESCRIPTION =
  "Track upcoming movies: release dates, casting, trailers, and a chronological update log for every film.";

export interface SeoInput {
  /** Page title; templated as "<title> · Upcoming Movies Tracker". Omit for the site name alone. */
  title?: string;
  /** Meta/OG description. Omit for the site default. */
  description?: string;
  /** Route pathname (e.g. location.pathname) → absolute canonical + og:url. Query is dropped. */
  pathname: string;
  /** Optional absolute or site-relative image → og:image + twitter:image. */
  image?: string;
  /** og:type. Defaults to "website". */
  type?: "website" | "article";
}

/** Build the shared SEO head descriptors for a public route's `meta()` export. */
export function buildMeta(input: SeoInput): MetaDescriptor[] {
  const title = input.title ? `${input.title} · ${SITE_NAME}` : SITE_NAME;
  const description = input.description ?? DEFAULT_DESCRIPTION;
  const url = new URL(input.pathname, env.publicSiteUrl).toString();

  const descriptors: MetaDescriptor[] = [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: input.type ?? "website" },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { name: "twitter:card", content: input.image ? "summary_large_image" : "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { tagName: "link", rel: "canonical", href: url },
  ];

  if (input.image) {
    const image = new URL(input.image, env.publicSiteUrl).toString();
    descriptors.push(
      { property: "og:image", content: image },
      { name: "twitter:image", content: image },
    );
  }

  return descriptors;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `task test -- src/lib/seo.test.ts`
Expected: PASS (all three cases). The canonical/og:url use the dev fallback origin `https://app.upmovies.localhost` because `VITE_PUBLIC_SITE_URL` is unset under Vitest.

- [ ] **Step 6: Add the env var to `.env` and `.env.example`**

Append to **both** `.env` and `.env.example`:

```
VITE_PUBLIC_SITE_URL=https://app.upmovies.localhost
```

> Production sets the real public origin at build time (Cloudflare build env). Used only for absolute canonical/`og:url`.

- [ ] **Step 7: Typecheck**

Run: `task typecheck`
Expected: PASS (`react-router typegen` + `tsc -b` clean).

---

### Task 2: Apply `buildMeta` to the `/preview` route (TDD)

Goal: the existing sample public route renders the full SEO head via the helper, and a test asserts it — this is the AC's "head tags render for a sample public route."

**Files:**
- Modify: `src/routes/preview.tsx`, `src/routes/preview.test.tsx`

- [ ] **Step 1: Add the failing meta test** — append a third `it(...)` inside the existing `describe("preview route", ...)` block in `src/routes/preview.test.tsx`, and add `meta` to the import:

Change the import line:

```ts
import Preview, { loader, meta } from "@/routes/preview";
```

Add this test inside the `describe` block:

```ts
it("builds SEO head tags for the public route", () => {
  const tags = meta({ location: { pathname: "/preview" } } as unknown as Parameters<typeof meta>[0]);
  expect(tags).toContainEqual({ title: "Preview · Upcoming Movies Tracker" });
  expect(tags.some((t) => "name" in t && t.name === "description")).toBe(true);
  expect(tags.some((t) => "property" in t && t.property === "og:title")).toBe(true);
  expect(
    tags.some((t) => "tagName" in t && t.tagName === "link" && t.rel === "canonical"),
  ).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- src/routes/preview.test.tsx`
Expected: FAIL — `meta()` still returns `[{ title: "Upcoming Movies" }]`, so the `"Preview · Upcoming Movies Tracker"` and `og:title` assertions fail.

- [ ] **Step 3: Update `meta()` in `src/routes/preview.tsx`**

Add the import and replace the `meta` function (keep the top `eslint-disable` comment, the `loader`, and the component unchanged):

```ts
/* eslint-disable react-refresh/only-export-components -- route files intentionally export loader + meta alongside the component */
import type { Route } from "./+types/preview";
import { buildMeta } from "@/lib/seo";

export async function loader() {
  return { message: "Public SSR is live." };
}

export function meta({ location }: Route.MetaArgs): Route.MetaDescriptors {
  return buildMeta({
    title: "Preview",
    description: "A server-rendered preview of the public Upcoming Movies Tracker surface.",
    pathname: location.pathname,
  });
}

export default function Preview({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">{loaderData.message}</h1>
    </main>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- src/routes/preview.test.tsx`
Expected: PASS — all three cases (loader, render, meta).

- [ ] **Step 5: Typecheck**

Run: `task typecheck`
Expected: PASS.

---

### Task 3: `/robots.txt` resource route (TDD)

Goal: a crawlable `robots.txt` that allows crawling, keeps the authed app out of the index, and references a same-origin sitemap.

**Files:**
- Create: `src/routes/robots.ts`, `src/routes/robots.test.ts`
- Modify: `src/routes.ts`

- [ ] **Step 1: Write the failing test** — `src/routes/robots.test.ts`:

```ts
import { RouterContextProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { loader } from "@/routes/robots";

describe("robots.txt", () => {
  it("allows crawl, disallows authed paths, and references a same-origin sitemap", async () => {
    const res = await loader({
      request: new Request("https://upmovies.example/robots.txt"),
      context: new RouterContextProvider(),
      params: {},
    });
    const text = await res.text();

    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(text).toMatch(/^User-agent: \*$/m);
    expect(text).toMatch(/^Allow: \/$/m);
    expect(text).toMatch(/^Disallow: \/login$/m);
    expect(text).toMatch(/^Disallow: \/signup$/m);
    expect(text).toMatch(/^Disallow: \/admin$/m);
    expect(text).toContain("Sitemap: https://upmovies.example/sitemap.xml");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- src/routes/robots.test.ts`
Expected: FAIL — cannot resolve `@/routes/robots`.

- [ ] **Step 3: Create `src/routes/robots.ts`** (resource route — loader only, no component, no JSX, so the `react-refresh` rule does not apply):

```ts
import type { Route } from "./+types/robots";

export function loader({ request }: Route.LoaderArgs) {
  const origin = new URL(request.url).origin;
  const body =
    "User-agent: *\n" +
    "Allow: /\n" +
    "Disallow: /login\n" +
    "Disallow: /signup\n" +
    "Disallow: /admin\n" +
    `Sitemap: ${origin}/sitemap.xml\n`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
```

- [ ] **Step 4: Register the route in `src/routes.ts`** — add `route("robots.txt", "routes/robots.ts")` as the first top-level entry:

```ts
import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  route("robots.txt", "routes/robots.ts"),

  layout("routes/public-layout.tsx", [route("preview", "routes/preview.tsx")]),

  layout("routes/spa-layout.tsx", [
    route("login", "pages/Login.tsx"),
    route("signup", "pages/Signup.tsx"),
    layout("components/RequireAuth.tsx", [
      layout("components/AppLayout.tsx", [
        index("pages/Home.tsx"),
        layout("components/RequireAdmin.tsx", [route("admin/ingest", "pages/AdminIngest.tsx")]),
      ]),
    ]),
  ]),
] satisfies RouteConfig;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `task test -- src/routes/robots.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck** (generates `./+types/robots` from the new route entry)

Run: `task typecheck`
Expected: PASS.

---

### Task 4: Worker load-context wiring + `/sitemap.xml` proxy (TDD)

Goal: a same-origin `/sitemap.xml` that forwards the backend's sitemap, reading the backend base URL from the Worker env through React Router v8's request context.

**Files:**
- Create: `src/lib/load-context.ts`, `src/routes/sitemap.ts`, `src/routes/sitemap.test.ts`
- Modify: `workers/app.ts`, `src/routes.ts`

- [ ] **Step 1: Create the shared context key** — `src/lib/load-context.ts` (plain types only, so it passes the client typecheck):

```ts
import { createContext } from "react-router";

/** The subset of Cloudflare Worker env that SSR loaders read. Kept minimal so this
 *  module references no Worker-only globals (`Env`/`ExecutionContext`) and type-checks
 *  under the client tsconfig. `workers/app.ts` maps the real `Env` into it. */
export interface AppEnv {
  API_BASE_URL: string;
}

/** Worker env exposed to SSR loaders via the request context (set in `workers/app.ts`). */
export const cloudflareContext = createContext<{ env: AppEnv }>();
```

- [ ] **Step 2: Write the failing test** — `src/routes/sitemap.test.ts` (MSW mocks the backend; the loader is called with a context carrying the backend base URL):

```ts
import { RouterContextProvider } from "react-router";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { cloudflareContext } from "@/lib/load-context";
import { loader } from "@/routes/sitemap";

const BACKEND = "https://api.upmovies.localhost";

function contextWithEnv() {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, { env: { API_BASE_URL: BACKEND } });
  return context;
}

describe("sitemap.xml", () => {
  it("proxies the backend sitemap as application/xml", async () => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset></urlset>';
    server.use(
      http.get(`${BACKEND}/sitemap.xml`, () =>
        HttpResponse.xml(xml, { headers: { "Content-Type": "application/xml" } }),
      ),
    );

    const res = await loader({
      request: new Request("https://upmovies.example/sitemap.xml"),
      context: contextWithEnv(),
      params: {},
    });

    expect(res.headers.get("content-type")).toContain("application/xml");
    expect(await res.text()).toBe(xml);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `task test -- src/routes/sitemap.test.ts`
Expected: FAIL — cannot resolve `@/routes/sitemap` (and `@/lib/load-context` is referenced by the test).

- [ ] **Step 4: Create `src/routes/sitemap.ts`** (resource route — loader only):

```ts
import type { Route } from "./+types/sitemap";
import { cloudflareContext } from "@/lib/load-context";

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const upstream = await fetch(new URL("/sitemap.xml", env.API_BASE_URL));
  const body = await upstream.text();

  return new Response(body, {
    status: upstream.status,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
```

- [ ] **Step 5: Wire the context in `workers/app.ts`** — replace the whole file:

```ts
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
```

> `env` (the generated `Env`, which has `API_BASE_URL: string`) is structurally assignable to the context's `{ env: AppEnv }`. `_ctx` stays unused (underscore-prefixed for `noUnusedParameters`).

- [ ] **Step 6: Register the route in `src/routes.ts`** — add `route("sitemap.xml", "routes/sitemap.ts")` as the second top-level entry, just after robots:

```ts
export default [
  route("robots.txt", "routes/robots.ts"),
  route("sitemap.xml", "routes/sitemap.ts"),

  layout("routes/public-layout.tsx", [route("preview", "routes/preview.tsx")]),
  // ... spa-layout branch unchanged
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `task test -- src/routes/sitemap.test.ts`
Expected: PASS — the loader fetches `https://api.upmovies.localhost/sitemap.xml` (intercepted by MSW) and returns the XML with `application/xml`.

- [ ] **Step 8: Typecheck** (generates `./+types/sitemap`; validates the `workers/app.ts` context wiring and `context.get` typing)

Run: `task typecheck`
Expected: PASS.

---

### Task 5: Full gate + handoff to commit

Goal: every CI check green locally before the single commit (per repo policy: run the full pipeline locally before pushing).

**Files:** none (verification only).

- [ ] **Step 1: Format only the touched files**

Run: `task format`
Then confirm only the files this plan created/modified are reformatted (don't reformat unrelated drifted files):

```bash
git -C upcoming-movies-frontend status --short
```

- [ ] **Step 2: Lint (zero warnings)**

Run: `task lint`
Expected: PASS — no errors, no warnings (unused imports / `react-refresh` violations fail). If `react-refresh/only-export-components` unexpectedly flags `robots.ts`/`sitemap.ts`, add the same inline disable comment used in `preview.tsx` at the top of the file; it should not, since those modules export no component.

- [ ] **Step 3: Typecheck**

Run: `task typecheck`
Expected: PASS (`react-router typegen` + `tsc -b` clean — both the client and cloudflare projects).

- [ ] **Step 4: Full test suite**

Run: `task test`
Expected: PASS — the existing suite plus the new `seo`, `robots`, `sitemap`, and `preview` meta tests. No prior tests changed behavior.

- [ ] **Step 5: Production build (Workers runtime parity)**

Run: `task build:app`
Expected: PASS — Vite emits the client + server bundles with no errors.

- [ ] **Step 6: (Optional) Manual verification with the container up**

Run: `task up`, then:

```bash
curl -k https://app.upmovies.localhost/robots.txt
curl -k https://app.upmovies.localhost/preview | grep -i 'og:title\|canonical\|<title'
```

Expected: `robots.txt` lists the rules + `Sitemap: https://app.upmovies.localhost/sitemap.xml`; `/preview`'s served HTML contains the `<title>`, `og:title`, and canonical tags **before** hydration.

> **Known dev caveat — the sitemap proxy:** `curl -k https://app.upmovies.localhost/sitemap.xml` makes the Worker fetch `https://api.upmovies.localhost/sitemap.xml` (self-signed TLS) from the workerd runtime, which may reject the cert in local dev. This does not affect CI (the test mocks `fetch`) or production. If it fails locally, it's the dev cert, not the code.

- [ ] **Step 7: Hand off to commit**

Tell the user the work is complete and verified, and that they should commit once and open one PR. Suggested commit subject:

```
feat: add SEO meta/OG helper, robots.txt, and sitemap proxy (NEU-307)
```

The PR body should note: the meta/OG helper (`buildMeta`), the `/robots.txt` and same-origin `/sitemap.xml` proxy resource routes, and that this introduces the Worker `cloudflareContext` load-context wiring NEU-306 deferred (reused by NEU-310). Keep the `🤖 Generated with Claude Code` footer; no `Co-Authored-By`.

---

## Self-Review

**Spec coverage** (against `2026-06-23-neu-307-seo-primitives-design.md`):
- Meta/OG helper for SSR routes → Task 1 (`src/lib/seo.ts`), applied in Task 2 (`/preview`).
- Title template "`<page>` · Upcoming Movies Tracker", `og:site_name` → Task 1 constants + tests.
- Deferred default OG image (optional `image` param; no default asset) → Task 1 (`image` optional; no-image test asserts `og:image` absent).
- Canonical + `og:url` from `VITE_PUBLIC_SITE_URL` + `location.pathname` → Task 1 (`env.publicSiteUrl`), Task 2 (passes `location.pathname`).
- `robots.txt`: allow all, disallow `/login` `/signup` `/admin`, same-origin `Sitemap:` → Task 3.
- Same-origin `/sitemap.xml` proxy forwarding backend NEU-309 (not duplicated) → Task 4.
- Runtime Worker env via `getLoadContext`/context wiring (first consumer; NEU-310 reuses) → Task 4 (`load-context.ts` + `workers/app.ts`).
- Resource routes (not `public/` static files) → Tasks 3 & 4 (loader-only `.ts` registered in `routes.ts`).
- Tests: Vitest head-tags for a sample route + `tsc -b`/eslint green → Tasks 1–4 tests + Task 5 gate.
- Dev TLS risk for the proxy noted → Task 5 Step 6.

**Placeholder scan:** No "TBD"/"TODO"/"add error handling"/"similar to". Every code step shows the full file or the exact edit. The one conditional (Task 5 Step 2) gives concrete fallback code, not a placeholder.

**Type consistency:**
- `buildMeta(input: SeoInput): MetaDescriptor[]` defined in Task 1; consumed in Task 2 via `Route.MetaDescriptors` (= `MetaDescriptor[]`).
- `cloudflareContext = createContext<{ env: AppEnv }>()` defined in Task 4 Step 1; `workers/app.ts` calls `context.set(cloudflareContext, { env })` (Step 5) and `sitemap.ts` calls `context.get(cloudflareContext)` (Step 4) — same key, same shape; `Env`→`AppEnv` is structural.
- `RouterContextProvider` / `createContext` / `createRequestHandler` are the real `react-router@^8` value exports (verified against the installed package); the v8 handler accepts a `RouterContextProvider` as its second arg.
- `env.publicSiteUrl` added in Task 1 Step 3 is the exact name read by `seo.ts` (Step 4).
- Loader args destructure only used params (`{ request }` in robots, `{ context }` in sitemap) to satisfy `noUnusedParameters`.

**Scope:** One cohesive frontend PR; no dependencies added; existing tests unchanged (only additive). No unrelated refactors.
