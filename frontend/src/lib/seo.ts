import type { MetaDescriptor } from "react-router";
import { env } from "@/env";

const SITE_NAME = "BackLotter";
const DEFAULT_DESCRIPTION =
  "Track upcoming movies: release dates, casting, trailers, and a chronological update log for every film.";

export interface SeoInput {
  /** Page title; templated as "<title> · BackLotter". Omit for the site name alone. */
  title?: string;
  /** Meta/OG description. Omit for the site default. */
  description?: string;
  /** Route pathname (e.g. location.pathname). Must not include query string — pass pathname only. */
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
