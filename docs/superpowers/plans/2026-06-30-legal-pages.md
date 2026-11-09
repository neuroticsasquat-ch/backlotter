# Terms of Service & Privacy Policy Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish Markdown-sourced Terms of Service (`/terms`) and Privacy Policy (`/privacy`) pages on the Backlotter frontend, linked from the site footer.

**Architecture:** Two static Markdown files are converted to HTML once at module scope via a small `renderMarkdown()` helper (using `marked`), then rendered server-side by route components inside a Tailwind `prose` container. Routes live under the existing `public-layout` so they inherit the header/search/footer. No loaders, no runtime data fetching.

**Tech Stack:** React Router v8 (framework mode, SSR), Vite, Tailwind v4, `marked`, `@tailwindcss/typography`, Vitest + Testing Library, Cloudflare Workers, pnpm via go-task.

## Global Constraints

- **All commands run inside the Docker container via go-task** (Docker-only dev). Container must be up: `task up`.
  - Add runtime dep: `task deps:add -- <pkg>` · Add dev dep: `task deps:add-dev -- <pkg>`
  - Tests: `task test` (or `task test -- <path>`) · Typecheck: `task typecheck` · Lint: `task lint` · Format: `task format`
- **Run the full CI pipeline locally before every push:** `task typecheck && task lint && task test`.
- **Format before commit:** run `task format`, then `git add -A`, then commit (pre-commit hooks delegate into Docker — commit normally, no `--no-verify`).
- **TypeScript style:** `X | Y` / `X | null` unions; no `Optional`. Modern syntax.
- **App is dark-only** — use `prose prose-invert` for legal-page typography.
- **Path alias:** `@/` → `src/`. `?raw` imports are typed by `vite/client` (already in tsconfig) — no extra `.d.ts` needed.
- **Filled legal values (verbatim):** operator `neuroticsasquat.ch`; governing law `State of Maryland`; deletion retention `30 days`; contact `support@backlotter.com`; data source `The Movie Database (TMDB)`; last-updated `2026-06-30`.
- **Route files** export `meta` alongside the component, so they need the `/* eslint-disable react-refresh/only-export-components */` header comment (matching existing routes).
- **Commit style:** Conventional Commits; this maps to Linear ticket NEU — add the parenthetical only if a ticket exists, else omit. No `Co-Authored-By` trailer.

---

### Task 1: `renderMarkdown` helper + `marked` dependency

**Files:**
- Create: `src/lib/markdown.ts`
- Create (test): `src/lib/markdown.test.ts`
- Modify: `package.json` (adds `marked` — via task command, not hand-edited)

**Interfaces:**
- Consumes: nothing.
- Produces: `renderMarkdown(md: string): string` — converts a Markdown string to an HTML string synchronously.

- [ ] **Step 1: Add the `marked` dependency**

Ensure the container is up, then add the dep:

```bash
task up
task deps:add -- marked
```

Expected: `marked` appears under `dependencies` in `package.json`.

- [ ] **Step 2: Write the failing test**

Create `src/lib/markdown.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/lib/markdown";

describe("renderMarkdown", () => {
  it("converts a heading to an <h1>", () => {
    expect(renderMarkdown("# Hello")).toContain("<h1>Hello</h1>");
  });

  it("converts a bullet list to <ul><li>", () => {
    const html = renderMarkdown("- one\n- two");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });

  it("renders paragraphs", () => {
    expect(renderMarkdown("a paragraph")).toContain("<p>a paragraph</p>");
  });

  it("preserves links", () => {
    const html = renderMarkdown("[Privacy](/privacy)");
    expect(html).toContain('href="/privacy"');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `task test -- src/lib/markdown.test.ts`
Expected: FAIL — cannot resolve `@/lib/markdown` / `renderMarkdown is not a function`.

- [ ] **Step 4: Write the helper**

Create `src/lib/markdown.ts`:

```ts
import { marked } from "marked";

/**
 * Convert a Markdown string to an HTML string.
 *
 * Used for our own static, PR-reviewed legal content only — never untrusted input —
 * so no sanitization step is needed. `marked` is pure string→string and runs on the
 * Cloudflare Workers edge runtime (no DOM required). `async: false` guarantees a
 * synchronous string return so callers can run it at module scope.
 */
export function renderMarkdown(md: string): string {
  return marked.parse(md, { async: false });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `task test -- src/lib/markdown.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck, lint, format, commit**

```bash
task typecheck && task lint && task format
git add -A
git commit -m "feat: add renderMarkdown helper backed by marked"
```

---

### Task 2: Terms of Service page (`/terms`) + typography plugin

**Files:**
- Modify: `src/styles/globals.css` (add the typography plugin — first `prose` use)
- Create: `src/content/legal/terms.md`
- Create: `src/routes/terms.tsx`
- Modify: `src/routes.ts` (register the route)
- Create (test): `src/routes/terms.test.tsx`
- Modify: `package.json` (adds `@tailwindcss/typography` — via task command)

**Interfaces:**
- Consumes: `renderMarkdown` from `@/lib/markdown` (Task 1); `buildMeta` from `@/lib/seo`.
- Produces: default-exported `TermsPage` component and `meta` export at route path `terms`.

- [ ] **Step 1: Add the typography plugin**

```bash
task deps:add-dev -- @tailwindcss/typography
```

Expected: `@tailwindcss/typography` appears under `devDependencies`.

- [ ] **Step 2: Enable the plugin in Tailwind v4 CSS**

In `src/styles/globals.css`, add the plugin import directly after the existing `@plugin "tailwindcss-animate";` line:

```css
@plugin "@tailwindcss/typography";
```

(Tailwind v4 registers plugins via the `@plugin` at-rule in CSS, not a JS config file.)

- [ ] **Step 3: Create the Terms content file**

Create `src/content/legal/terms.md`:

```markdown
# Terms of Service

**Last updated: 2026-06-30**

## 1. Acceptance of Terms

By accessing or using Backlotter (the "Service"), operated by neuroticsasquat.ch ("we," "us," or "our"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the Service.

We may update these Terms from time to time. If we make material changes, we will notify you (for example, by email or an in-app notice) before they take effect. Your continued use of the Service after changes become effective constitutes acceptance of the revised Terms.

## 2. Eligibility

You must be at least 13 years old (or the minimum age required in your jurisdiction) to use the Service. By using the Service, you represent that you meet this requirement.

## 3. Your Account

To use certain features, you must create an account and provide an email address. You are responsible for:

- Maintaining the confidentiality of your login credentials;
- All activity that occurs under your account; and
- Notifying us promptly of any unauthorized use.

You may delete your account at any time. Upon deletion, we will remove or anonymize your personal information as described in our [Privacy Policy](/privacy), subject to any retention required by law.

## 4. Acceptable Use

You agree not to:

- Use the Service for any unlawful purpose or in violation of these Terms;
- Attempt to gain unauthorized access to the Service, other accounts, or our systems;
- Scrape, crawl, or harvest data from the Service except as expressly permitted;
- Interfere with or disrupt the integrity or performance of the Service; or
- Reverse engineer or attempt to extract source code, except where such restriction is prohibited by law.

We may suspend or terminate your access if you violate these Terms.

## 5. Content and Intellectual Property

The Service, including its design, software, and original content, is owned by us and protected by intellectual property laws. Movie metadata, images, and related information are provided by The Movie Database (TMDB) and remain the property of their respective owners. We grant you a limited, non-exclusive, non-transferable license to use the Service for personal, non-commercial purposes.

## 6. Privacy and Your Data

Your privacy matters to us. Our collection and use of personal information is governed by our [Privacy Policy](/privacy), which is incorporated into these Terms by reference. In particular:

- **We will not sell, rent, or trade your personally identifiable information** — including your email address, name, or any other data that could reasonably be used to identify you — to third parties.
- **We may create, use, and share aggregated or de-identified data** that does not identify you or any individual user. For example, we may share or sell statistics about overall viewing trends, anticipated-release interest, or usage patterns, provided such data has been aggregated and/or anonymized so that it cannot reasonably be linked back to you.

We use the personal information you provide to operate, maintain, and improve the Service, and to communicate with you about your account. See our [Privacy Policy](/privacy) for full details.

## 7. Third-Party Services

The Service may link to or integrate with third-party services. We are not responsible for the content, policies, or practices of any third party. Your use of those services is governed by their own terms.

## 8. Disclaimers

THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. We do not warrant that the Service will be uninterrupted, error-free, or that release dates or other information will be accurate.

## 9. Limitation of Liability

TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF DATA, PROFITS, OR GOODWILL, ARISING FROM YOUR USE OF THE SERVICE. OUR TOTAL LIABILITY FOR ANY CLAIM RELATING TO THE SERVICE WILL NOT EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID US IN THE 12 MONTHS PRECEDING THE CLAIM, OR (B) USD $100.

## 10. Termination

We may suspend or terminate your access to the Service at any time, with or without cause or notice. You may stop using the Service at any time. Sections that by their nature should survive termination (including Sections 5, 6, 8, 9, and 11) will survive.

## 11. Governing Law

These Terms are governed by the laws of the State of Maryland, without regard to its conflict-of-laws principles. Any dispute will be resolved in the state or federal courts located in the State of Maryland, and you consent to their jurisdiction.

## 12. Contact

Questions about these Terms? Contact us at support@backlotter.com.
```

- [ ] **Step 4: Write the failing test**

Create `src/routes/terms.test.tsx`:

```tsx
import { createRoutesStub } from "react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TermsPage, { meta } from "@/routes/terms";

describe("terms route meta", () => {
  it("sets a Terms-of-Service title and a canonical link", () => {
    const tags = meta({
      location: { pathname: "/terms" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags.some((t) => "title" in t && /Terms of Service/.test(String(t.title)))).toBe(true);
    expect(tags.some((t) => "tagName" in t && t.tagName === "link" && t.rel === "canonical")).toBe(
      true,
    );
  });
});

describe("terms route render", () => {
  it("renders the Terms heading and the last-updated date", async () => {
    const Stub = createRoutesStub([{ path: "/terms", Component: TermsPage }]);
    render(<Stub initialEntries={["/terms"]} />);
    expect(
      await screen.findByRole("heading", { level: 1, name: /terms of service/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/last updated: 2026-06-30/i)).toBeInTheDocument();
  });

  it("links to the privacy policy", async () => {
    const Stub = createRoutesStub([{ path: "/terms", Component: TermsPage }]);
    const { container } = render(<Stub initialEntries={["/terms"]} />);
    await screen.findByRole("heading", { level: 1, name: /terms of service/i });
    expect(container.querySelector('a[href="/privacy"]')).not.toBeNull();
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `task test -- src/routes/terms.test.tsx`
Expected: FAIL — cannot resolve `@/routes/terms`.

- [ ] **Step 6: Create the route component**

Create `src/routes/terms.tsx`:

```tsx
/* eslint-disable react-refresh/only-export-components -- route files intentionally export meta alongside the component */
import type { Route } from "./+types/terms";
import { buildMeta } from "@/lib/seo";
import { renderMarkdown } from "@/lib/markdown";
import termsMd from "@/content/legal/terms.md?raw";

// Converted once at module load — the content is static, so there is no per-request work
// and no loader. The component is still server-rendered, so the HTML ships in the SSR response.
const html = renderMarkdown(termsMd);

export function meta({ location }: Route.MetaArgs): Route.MetaDescriptors {
  return buildMeta({
    title: "Terms of Service",
    description: "The terms governing your use of Backlotter.",
    pathname: location.pathname,
  });
}

export default function TermsPage() {
  return (
    <article
      className="prose prose-invert mx-auto max-w-3xl px-4 py-8"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
```

- [ ] **Step 7: Register the route**

In `src/routes.ts`, add the `terms` route inside the existing `layout("routes/public-layout.tsx", [...])` array, after the `film/:slug` route:

```ts
    route("film/:slug", "routes/film.tsx"),
    route("terms", "routes/terms.tsx"),
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `task test -- src/routes/terms.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 9: Typecheck, lint, format, commit**

```bash
task typecheck && task lint && task format
git add -A
git commit -m "feat: add Terms of Service page at /terms"
```

---

### Task 3: Privacy Policy page (`/privacy`)

**Files:**
- Create: `src/content/legal/privacy.md`
- Create: `src/routes/privacy.tsx`
- Modify: `src/routes.ts` (register the route)
- Create (test): `src/routes/privacy.test.tsx`

**Interfaces:**
- Consumes: `renderMarkdown` from `@/lib/markdown` (Task 1); `buildMeta` from `@/lib/seo`; the `prose` typography plugin enabled in Task 2.
- Produces: default-exported `PrivacyPage` component and `meta` export at route path `privacy`.

- [ ] **Step 1: Create the Privacy content file**

Create `src/content/legal/privacy.md`:

```markdown
# Privacy Policy

**Last updated: 2026-06-30**

This Privacy Policy explains how neuroticsasquat.ch ("we," "us," or "our") collects, uses, and shares information when you use Backlotter (the "Service"). It is incorporated into our [Terms of Service](/terms) by reference. By using the Service, you agree to the practices described here.

## 1. Information We Collect

**Information you provide:**

- **Account information** — your email address and password (stored hashed, never in plain text).
- **Profile and preferences** — movies you track, watchlists, ratings, notification settings, and similar data you create in the Service.
- **Communications** — messages you send us (e.g., support requests).

**Information we collect automatically:**

- **Usage data** — features used, pages viewed, actions taken, and timestamps.
- **Device and log data** — IP address, browser type, operating system, and similar technical information.
- **Cookies and similar technologies** — used to keep you signed in, remember preferences, and understand usage. See Section 8.

**Information from third parties:**

- Movie metadata, images, and release information come from The Movie Database (TMDB). This is not your personal information.

## 2. How We Use Your Information

We use your information to:

- Operate, maintain, and provide the Service;
- Authenticate you and secure your account;
- Send you account-related and Service notifications (e.g., release alerts you've opted into);
- Respond to your requests and provide support;
- Analyze and improve the Service; and
- Comply with legal obligations and enforce our Terms.

## 3. Email Communications

We use your email address to send account and transactional messages, and any notifications you opt into. We will not send you marketing email from third parties, and we will not provide your email address to third parties for their marketing. You can manage notification preferences in your account settings or unsubscribe via the link in any non-essential email.

## 4. We Do Not Sell Your Personal Information

**We do not sell, rent, lease, or trade your personally identifiable information** — including your email address, name, account credentials, or any other information that could reasonably be used to identify you — to any third party.

We share your personal information only in the limited circumstances described in Section 6.

## 5. Aggregated and De-Identified Data

We may create, use, share, and sell **aggregated or de-identified data** — that is, information that has been combined across users and/or stripped of identifiers so that it does not identify, and cannot reasonably be used to identify, you or any individual.

Examples include statistics about overall interest in upcoming releases, aggregate viewing or tracking trends, and general usage patterns.

When we create or share such data:

- We use reasonable measures to ensure it cannot reasonably be re-associated with any individual;
- We will not attempt to re-identify it, and we will contractually require recipients not to attempt to re-identify it; and
- It will never include your email address or other direct identifiers.

This is the only category of data we may sell, and by definition it does not identify you.

## 6. How We Share Personal Information

We share your personal information only as follows:

- **Service providers** — vendors who process data on our behalf (e.g., hosting, email delivery, error monitoring), bound by confidentiality and permitted to use it only to provide services to us.
- **Legal and safety** — when required by law, subpoena, or legal process, or to protect the rights, property, or safety of us, our users, or the public.
- **Business transfers** — in connection with a merger, acquisition, or sale of assets, in which case we will notify you of any change in how your information is handled.
- **With your consent** — when you direct us to share it.

We do **not** share your personal information with third parties for their own marketing purposes.

## 7. Data Retention and Deletion

We retain your personal information for as long as your account is active or as needed to provide the Service. When you delete your account, we delete or anonymize your personal information within 30 days, except where retention is required by law or for legitimate business records. Aggregated or de-identified data derived before deletion may be retained, as it no longer identifies you.

## 8. Cookies

We use cookies and similar technologies to keep you signed in, remember your preferences, and analyze usage. You can control cookies through your browser settings, though disabling them may affect functionality.

## 9. Security

We use reasonable technical and organizational measures to protect your information, including encryption in transit and hashed passwords. No method of transmission or storage is completely secure, and we cannot guarantee absolute security.

## 10. Your Rights

Depending on where you live, you may have rights to:

- Access the personal information we hold about you;
- Correct inaccurate information;
- Delete your information;
- Object to or restrict certain processing; and
- Receive a copy of your data in a portable format.

To exercise these rights, contact us at support@backlotter.com. We will not discriminate against you for exercising them.

**California residents (CCPA/CPRA):** You have the right to know, delete, and correct your personal information, and to opt out of its "sale" or "sharing." As stated, we do not sell or share your personal information as those terms are defined, other than aggregated/de-identified data that falls outside those definitions.

**EU/UK residents (GDPR):** We process your information on the legal bases of contract (to provide the Service), legitimate interests (to improve and secure it), consent (where required, e.g., certain notifications), and legal obligation. You may lodge a complaint with your local supervisory authority.

## 11. Children's Privacy

The Service is not directed to children under 13, and we do not knowingly collect personal information from them. If we learn we have, we will delete it.

## 12. Changes to This Policy

We may update this Policy from time to time. If we make material changes, we will notify you (e.g., by email or in-app notice) before they take effect.

## 13. Contact

Questions or requests? Contact us at support@backlotter.com.
```

- [ ] **Step 2: Write the failing test**

Create `src/routes/privacy.test.tsx`:

```tsx
import { createRoutesStub } from "react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PrivacyPage, { meta } from "@/routes/privacy";

describe("privacy route meta", () => {
  it("sets a Privacy-Policy title and a canonical link", () => {
    const tags = meta({
      location: { pathname: "/privacy" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags.some((t) => "title" in t && /Privacy Policy/.test(String(t.title)))).toBe(true);
    expect(tags.some((t) => "tagName" in t && t.tagName === "link" && t.rel === "canonical")).toBe(
      true,
    );
  });
});

describe("privacy route render", () => {
  it("renders the Privacy heading and the last-updated date", async () => {
    const Stub = createRoutesStub([{ path: "/privacy", Component: PrivacyPage }]);
    render(<Stub initialEntries={["/privacy"]} />);
    expect(
      await screen.findByRole("heading", { level: 1, name: /privacy policy/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/last updated: 2026-06-30/i)).toBeInTheDocument();
  });

  it("states we do not sell personal information and may sell aggregated data", async () => {
    const Stub = createRoutesStub([{ path: "/privacy", Component: PrivacyPage }]);
    render(<Stub initialEntries={["/privacy"]} />);
    await screen.findByRole("heading", { level: 1, name: /privacy policy/i });
    expect(screen.getByText(/we do not sell, rent, lease, or trade/i)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /aggregated and de-identified data/i }),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `task test -- src/routes/privacy.test.tsx`
Expected: FAIL — cannot resolve `@/routes/privacy`.

- [ ] **Step 4: Create the route component**

Create `src/routes/privacy.tsx`:

```tsx
/* eslint-disable react-refresh/only-export-components -- route files intentionally export meta alongside the component */
import type { Route } from "./+types/privacy";
import { buildMeta } from "@/lib/seo";
import { renderMarkdown } from "@/lib/markdown";
import privacyMd from "@/content/legal/privacy.md?raw";

const html = renderMarkdown(privacyMd);

export function meta({ location }: Route.MetaArgs): Route.MetaDescriptors {
  return buildMeta({
    title: "Privacy Policy",
    description: "How Backlotter collects, uses, and protects your information.",
    pathname: location.pathname,
  });
}

export default function PrivacyPage() {
  return (
    <article
      className="prose prose-invert mx-auto max-w-3xl px-4 py-8"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
```

- [ ] **Step 5: Register the route**

In `src/routes.ts`, add the `privacy` route immediately after the `terms` route added in Task 2:

```ts
    route("terms", "routes/terms.tsx"),
    route("privacy", "routes/privacy.tsx"),
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `task test -- src/routes/privacy.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 7: Typecheck, lint, format, commit**

```bash
task typecheck && task lint && task format
git add -A
git commit -m "feat: add Privacy Policy page at /privacy"
```

---

### Task 4: Footer links to Terms & Privacy

**Files:**
- Modify: `src/components/layout/GlobalFooter.tsx`
- Modify (test): `src/components/layout/GlobalFooter.test.tsx`

**Interfaces:**
- Consumes: `/terms` and `/privacy` routes (Tasks 2–3); React Router `Link`.
- Produces: two internal footer links.

- [ ] **Step 1: Add the failing test assertions**

In `src/components/layout/GlobalFooter.test.tsx`, add this `describe` block after the existing TMDB-attribution test:

```tsx
describe("legal links", () => {
  it("links to the Terms of Service page", () => {
    renderFooter();
    expect(screen.getByRole("link", { name: /terms/i })).toHaveAttribute("href", "/terms");
  });

  it("links to the Privacy Policy page", () => {
    renderFooter();
    expect(screen.getByRole("link", { name: /privacy/i })).toHaveAttribute("href", "/privacy");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- src/components/layout/GlobalFooter.test.tsx`
Expected: FAIL — no link named "terms"/"privacy" found.

- [ ] **Step 3: Add the links to the footer**

In `src/components/layout/GlobalFooter.tsx`, import `Link` from `react-router` at the top:

```tsx
import { Link } from "react-router";
import { WORDMARK } from "@/components/layout/nav-items";
```

Then add a links row inside the centered container, immediately after the TMDB attribution `<p>...</p>` and before the closing `</div>`:

```tsx
        <nav aria-label="Legal" className="flex gap-4">
          <Link
            to="/terms"
            className="underline underline-offset-4 transition-colors hover:text-foreground"
          >
            Terms
          </Link>
          <Link
            to="/privacy"
            className="underline underline-offset-4 transition-colors hover:text-foreground"
          >
            Privacy
          </Link>
        </nav>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- src/components/layout/GlobalFooter.test.tsx`
Expected: PASS — including the existing "no footer navigation menu" test, which queries for the navigation named `/footer navigation/i` and so is unaffected by an `aria-label="Legal"` nav.

- [ ] **Step 5: Full CI pipeline, format, commit**

```bash
task typecheck && task lint && task test
task format
git add -A
git commit -m "feat: link Terms and Privacy from the site footer"
```

---

## Verification (after all tasks)

- [ ] Full pipeline green: `task typecheck && task lint && task test`.
- [ ] Manual smoke (optional): `task up`, visit `/terms` and `/privacy` at the dev host — headings, prose spacing, and the cross-links between the two pages render; footer shows Terms + Privacy links on every public page.
