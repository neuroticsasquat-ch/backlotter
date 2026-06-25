/* eslint-disable react-refresh/only-export-components -- route files intentionally export loader + meta + ErrorBoundary alongside the component */
import { isRouteErrorResponse, Link } from "react-router";
import type { Route } from "./+types/film";
import { getFilm } from "@/api/public";
import { cloudflareContext } from "@/lib/load-context";
import { buildMeta } from "@/lib/seo";
import { posterUrl } from "@/lib/poster";
import { truncate } from "@/lib/format";
import { FilmHeader } from "@/components/film/FilmHeader";
import { EventTimeline } from "@/components/film/EventTimeline";

export async function loader({ params, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const film = await getFilm(env.API_BASE_URL, params.slug);
  if (!film) {
    throw new Response(null, { status: 404, statusText: "Film not found" });
  }
  return { film };
}

export function meta({ loaderData, location }: Route.MetaArgs): Route.MetaDescriptors {
  if (!loaderData?.film) {
    return [
      ...buildMeta({ title: "Film not found", pathname: location.pathname }),
      { name: "robots", content: "noindex" },
    ];
  }
  const { film } = loaderData;
  const title = film.release_year ? `${film.title} (${film.release_year})` : film.title;
  // Pick the newest event by occurred_at, independent of array order (ISO-8601 sorts chronologically).
  const latest = [...film.events].sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))[0]
    ?.summary;
  const description = latest
    ? truncate(latest)
    : `Release dates, casting, trailers, and the full update timeline for ${title}.`;
  return buildMeta({
    title,
    description,
    pathname: location.pathname,
    image: posterUrl(film.poster_path, "w780") ?? undefined,
    type: "article",
  });
}

export default function FilmPage({ loaderData }: Route.ComponentProps) {
  const { film } = loaderData;
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <FilmHeader film={film} />
      <EventTimeline events={film.events} />
    </main>
  );
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">
        {isNotFound ? "Film not found" : "Something went wrong"}
      </h1>
      <p className="mt-2 text-sm text-gray-500">
        {isNotFound
          ? "We couldn't find that film. It may have moved or never existed."
          : "Please try again in a moment."}
      </p>
      <Link to="/" className="mt-6 inline-block text-sm text-blue-600 underline">
        Back to home
      </Link>
    </main>
  );
}
