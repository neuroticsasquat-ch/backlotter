import type { Route } from "./+types/robots";

export function loader({ request }: Route.LoaderArgs) {
  const origin = new URL(request.url).origin;
  const body =
    "User-agent: *\n" +
    "Allow: /\n" +
    "Disallow: /login\n" +
    "Disallow: /signup\n" +
    "Disallow: /admin/\n" +
    `Sitemap: ${origin}/sitemap.xml\n`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
