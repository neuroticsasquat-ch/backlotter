# Design: Terms of Service & Privacy Policy pages

**Date:** 2026-06-30
**Repo:** `upcoming-movies-frontend` (Backlotter frontend)
**Status:** Approved — ready for implementation plan

## Goal

Publish two static legal pages — Terms of Service (`/terms`) and Privacy Policy
(`/privacy`) — rendered from Markdown source files, and link to them from the site
footer. The Privacy Policy encodes two business commitments:

1. We do **not** sell personally identifiable information, including email addresses.
2. We **may** sell aggregated / de-identified data that cannot reasonably be linked
   back to an individual.

## Context

The frontend is React Router v8 in **framework mode** (SSR) + Vite + Tailwind v4,
deployed to Cloudflare Workers. Public pages render inside `routes/public-layout.tsx`
(`GlobalHeader` → search bar → routed `<main>` → `GlobalFooter`). The footer is fully
server-rendered with no providers and already contains a TMDB attribution link whose
styling we will mirror. `dompurify` is already a dependency.

## Filled-in legal values

| Placeholder        | Value                          |
| ------------------ | ------------------------------ |
| Operator / entity  | neuroticsasquat.ch             |
| Governing law      | State of Maryland (state-level; county TBD by counsel) |
| Deletion retention | 30 days                        |
| Contact email      | support@backlotter.com         |
| Third-party data   | The Movie Database (TMDB)      |
| Last updated       | 2026-06-30                     |

> Not legal advice. These are boilerplate drafts; counsel should review before any
> material change, especially the Privacy Policy data clauses.

## Architecture

### Content (source of truth)

- `src/content/legal/terms.md`
- `src/content/legal/privacy.md`

Each begins with a `Last updated: 2026-06-30` line and uses the filled-in values above.
Content is the ToS + Privacy Policy drafted in conversation.

### Rendering pipeline (server-side)

- New dependency: `marked` (Markdown → HTML). `marked` is pure string→string and runs on
  the Cloudflare Workers edge runtime.
- **No `dompurify`.** Sanitization defends against untrusted input; the content here is our
  own static, PR-reviewed Markdown, so there is no XSS vector. `dompurify` also needs a DOM,
  which Workers lacks — pulling in `isomorphic-dompurify`/jsdom would be unjustified weight.
- Helper `src/lib/markdown.ts` exporting `renderMarkdown(md: string): string` — runs
  `marked` synchronously and returns HTML. Single purpose; unit-testable.
- Routes `src/routes/terms.tsx` and `src/routes/privacy.tsx`:
  - Import their Markdown via Vite `?raw` (e.g. `import md from "@/content/legal/terms.md?raw"`).
  - Because the content is fully static, there is **no `loader`** — convert to HTML once at
    module scope (`const html = renderMarkdown(md)`). The route component is still SSR'd, so
    the HTML ships server-rendered (good for SEO).
  - Render the HTML inside a `prose` container via `dangerouslySetInnerHTML`.
  - Export a `meta` setting page `<title>` and description via `buildMeta` from `@/lib/seo`.
- Register both routes inside the existing `layout("routes/public-layout.tsx", [...])`
  block in `src/routes.ts` so they inherit header/search/footer.

### Styling

- Add `@tailwindcss/typography`; enable per Tailwind v4 conventions in `globals.css`.
- Wrap rendered HTML in `<article className="prose prose-invert ...">` (the app is
  dark-only) inside the site's `max-w-3xl` content width (matching the search bar
  container) with vertical padding.

### Footer links

- Add "Terms" and "Privacy" links to `GlobalFooter`, styled like the existing TMDB link
  (underline / hover), using React Router `<Link>` (internal navigation, not
  `<a target="_blank">`).

## Data flow

```
terms.md ──(?raw import)──▶ terms.tsx loader ──renderMarkdown()──▶ sanitized HTML
                                                                      │
                                                          SSR ◀───────┘
                                                          │
                              public-layout (header/search/footer) ─▶ <article class="prose">
```

No runtime data fetching, no auth, no API calls. Pure static content rendered at the edge.

## Error handling

Minimal: content is bundled at build time, so there is no fetch/network failure path.
If `marked`/`dompurify` throw on malformed input, the route errors out to React Router's
standard error boundary — acceptable because the input is our own static, reviewed files.

## Testing (colocated `*.test.*`, matching repo convention)

- `src/lib/markdown.test.ts` — renders known Markdown and asserts the expected HTML
  (e.g. `# H` → `<h1>H</h1>`, a list → `<ul><li>`).
- `src/routes/terms.test.tsx` / `src/routes/privacy.test.tsx` — route renders; assert a
  known heading and the "Last updated" string appear.
- Footer: extend existing footer/layout test to assert the two new links render with the
  correct `href` (`/terms`, `/privacy`).

## Out of scope

- Cookie consent banner / preferences UI.
- Versioned legal history or change-tracking beyond the "Last updated" line.
- A CMS or admin editor — edits happen via PR to the Markdown files.
- County-level venue in the governing-law clause (left to counsel).

## Notes

- The umbrella `~/projects/upcoming-movies` is not a git repo, so this spec is not
  committed; implementation lands in the `upcoming-movies-frontend` repo.
