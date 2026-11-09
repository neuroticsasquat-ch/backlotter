/* eslint-disable react-refresh/only-export-components -- route files intentionally export meta alongside the component */
import type { Route } from "./+types/terms";
import { buildMeta } from "@/lib/seo";
import { renderMarkdown } from "@/lib/markdown";
import { LegalArticle } from "@/components/LegalArticle";
import termsMd from "@/content/legal/terms.md?raw";

// Converted once at module load — the content is static, so there is no per-request work
// and no loader. The component is still server-rendered, so the HTML ships in the SSR response.
const html = renderMarkdown(termsMd);

export function meta({ location }: Route.MetaArgs): Route.MetaDescriptors {
  return buildMeta({
    title: "Terms of Service",
    description: "The terms governing your use of Backlotter.",
    pathname: location.pathname,
    type: "article",
  });
}

export default function TermsPage() {
  return <LegalArticle html={html} />;
}
