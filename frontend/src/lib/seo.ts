import type { MetaDescriptor } from "react-router";
import { env } from "@/env";

// Brand name as shown in headings, the wordmark, and og:site_name.
export const SITE_NAME = "BackLotter";
// Document-title branding (the browser tab): lowercase brand + tagline, matching the wordmark.
const TITLE_BRAND = "backlotter";
const TITLE_TAGLINE = "production log";
const DEFAULT_DESCRIPTION =
  "Track upcoming movies: release dates, casting, trailers, and a chronological update log for every film.";

export interface SeoInput {
  /** Page title; templated as "<title> — backlotter". Omit for "backlotter — production log". */
  title?: string;
  /** Meta/OG description. Omit for the site default. */
  description?: string;
  /** Route pathname (e.g. location.pathname). Must not include query string — pass pathname only. */
  pathname: string;
  /**
   * Optional query string (e.g. "?page=2") folded into the canonical + og:url so paginated
   * pages self-canonicalize. Omit (or pass "") for the bare-pathname URL. Pages 2+ of a
   * paginated route MUST set this, or the canonical points back to page 1 and fights rel=prev/next.
   */
  search?: string;
  /** Optional absolute or site-relative image → og:image + twitter:image. */
  image?: string;
  /** og:type. Defaults to "website". */
  type?: "website" | "article";
}

/** Build the shared SEO head descriptors for a public route's `meta()` export. */
export function buildMeta(input: SeoInput): MetaDescriptor[] {
  const title = input.title
    ? `${input.title} — ${TITLE_BRAND}`
    : `${TITLE_BRAND} — ${TITLE_TAGLINE}`;
  const description = input.description ?? DEFAULT_DESCRIPTION;
  const url = new URL(input.pathname + (input.search ?? ""), env.publicSiteUrl).toString();

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
