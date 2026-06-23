import type { Route } from "./+types/sitemap";
import { cloudflareContext } from "@/lib/load-context";

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
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
