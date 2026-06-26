import type { Route } from "./+types/sitemap";
import { cloudflareContext } from "@/lib/load-context";

export function injectBrowseUrl(xml: string): string {
  const locMatch = xml.match(/<loc>([\s\S]*?)<\/loc>/);
  if (!locMatch) return xml;
  // Derive the site root from the first <loc>'s origin — robust even if that entry is a deep
  // path (a trailing-slash strip would otherwise yield e.g. .../film/foo/browse).
  let base: string;
  try {
    base = new URL(locMatch[1].trim()).origin;
  } catch {
    return xml;
  }
  const browseEntry = `<url><loc>${base}/browse</loc></url>`;
  const closeTag = "</urlset>";
  const closeIndex = xml.lastIndexOf(closeTag);
  if (closeIndex === -1) return xml;
  return xml.slice(0, closeIndex) + browseEntry + xml.slice(closeIndex);
}

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  let upstream: Response;
  try {
    upstream = await fetch(new URL("/sitemap.xml", env.API_BASE_URL));
  } catch {
    return new Response("<?xml version='1.0'?><urlset/>", {
      status: 503,
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
  }
  const body = injectBrowseUrl(await upstream.text());
  return new Response(body, {
    status: upstream.status,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
