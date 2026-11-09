/* eslint-disable react-refresh/only-export-components -- route files intentionally export meta alongside the component */
import type { Route } from "./+types/privacy";
import { buildMeta } from "@/lib/seo";
import { renderMarkdown } from "@/lib/markdown";
import { LegalArticle } from "@/components/LegalArticle";
import privacyMd from "@/content/legal/privacy.md?raw";

// Converted once at module load — the content is static, so there is no per-request work
// and no loader. The component is still server-rendered, so the HTML ships in the SSR response.
const html = renderMarkdown(privacyMd);

export function meta({ location }: Route.MetaArgs): Route.MetaDescriptors {
  return buildMeta({
    title: "Privacy Policy",
    description: "How Backlotter collects, uses, and protects your information.",
    pathname: location.pathname,
    type: "article",
  });
}

export default function PrivacyPage() {
  return <LegalArticle html={html} />;
}
