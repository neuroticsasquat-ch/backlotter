/* eslint-disable react-refresh/only-export-components -- route files intentionally export loader + meta + ErrorBoundary alongside the component */
import { Link } from "react-router";
import type { Route } from "./+types/search";
import { getFilmSearch } from "@/api/public";
import { cloudflareContext } from "@/lib/load-context";
import { buildMeta } from "@/lib/seo";
import { FilmPosterCard } from "@/components/browse/FilmPosterCard";
import { Pagination } from "@/components/browse/Pagination";

const PAGE_SIZE = 20;

function clampToInt(value: string | null, fallback: number): number {
  const n = parseInt(value ?? "", 10);
  return isNaN(n) || n < 1 ? fallback : n;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const page = clampToInt(url.searchParams.get("page"), 1);
  if (!q) return { q, results: null, page, totalPages: 1 };
  const offset = (page - 1) * PAGE_SIZE;
  const results = await getFilmSearch(env.API_BASE_URL, q, { limit: PAGE_SIZE, offset });
  const totalPages = Math.max(1, Math.ceil(results.total / PAGE_SIZE));
  return { q, results, page, totalPages };
}

export function meta({ location, loaderData }: Route.MetaArgs) {
  const q = loaderData?.q ?? "";
  return [
    ...buildMeta({
      title: q ? `Search: "${q}"` : "Search",
      pathname: location.pathname,
    }),
    { name: "robots", content: "noindex" },
  ];
}

export default function SearchPage({ loaderData }: Route.ComponentProps) {
  const { q, results, page, totalPages } = loaderData;

  if (results === null) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">Search Films</h1>
        <p className="mt-6 text-sm text-gray-500">Type a film title to search.</p>
      </main>
    );
  }

  if (results.total === 0) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">Search Films</h1>
        <p className="mt-6 text-sm text-gray-500">No films match &ldquo;{q}&rdquo;.</p>
      </main>
    );
  }

  if (results.items.length === 0) {
    // total > 0 but no items on this page → the page is past the end (e.g. ?page=999),
    // not that nothing matched. Don't show the no-results copy in that case.
    return (
      <main className="mx-auto max-w-7xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">Search Films</h1>
        <p className="mt-6 text-sm text-gray-500">That page is past the end of the results.</p>
        <Link
          to={`/search?q=${encodeURIComponent(q)}`}
          className="mt-6 inline-block text-sm text-blue-600 underline"
        >
          Back to the first page
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Search Films</h1>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {results.items.map((f) => (
          <FilmPosterCard key={f.slug} item={f} />
        ))}
      </div>
      <div className="mt-6">
        <Pagination page={page} totalPages={totalPages} />
      </div>
    </main>
  );
}

export function ErrorBoundary() {
  return (
    <div>
      <p>We couldn&apos;t run that search.</p>
      <a href="/">Go home</a>
    </div>
  );
}
