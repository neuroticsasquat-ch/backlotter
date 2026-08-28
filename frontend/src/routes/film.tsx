/* eslint-disable react-refresh/only-export-components -- route files intentionally export loader + meta + ErrorBoundary alongside the component */
import { isRouteErrorResponse, Link, redirect } from "react-router";
import type { Route } from "./+types/film";
import { getFilm } from "@/api/public";
import { cloudflareContext } from "@/lib/load-context";
import { buildMeta } from "@/lib/seo";
import { posterUrl } from "@/lib/poster";
import { truncate } from "@/lib/format";
import { FilmHeader } from "@/components/film/FilmHeader";
import { FilmCredits } from "@/components/film/FilmCredits";
import { FilmCrew } from "@/components/film/FilmCrew";
import { FilmPlot } from "@/components/film/FilmPlot";
import { ProductionCompanies } from "@/components/film/ProductionCompanies";
import { ReleaseDates } from "@/components/film/ReleaseDates";
import { EventTimeline } from "@/components/film/EventTimeline";
import type { FilmEvent } from "@/api/types";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const film = await getFilm(env.API_BASE_URL, params.ref);
  if (!film) {
    throw new Response(null, { status: 404, statusText: "Film not found" });
  }
  // A ref resolves on its leading id, so several URLs reach the same film: one minted before
  // NEU-1143 (a bare legacy slug), a bare id, or a ref whose decorative half was built from a
  // title the film has since outgrown. Send all of them to the canonical form.
  //
  // 301, not 302: the old URLs are in the sitemap and indexed, and a permanent redirect is what
  // moves the ranking signal onto the URL we now emit. A temporary one strands it on a URL that
  // no longer appears anywhere.
  if (params.ref !== film.ref) {
    const url = new URL(request.url);
    url.pathname = `/film/${film.ref}`;
    throw redirect(url.toString(), 301);
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
  // Flatten day_groups to find the newest event by created_at for SEO description.
  const allEvents: FilmEvent[] = film.day_groups.flatMap(
    (g) => [...g.news_events, ...g.tmdb_events],
  );
  const latest = allEvents.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]
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
      <div className="mt-6">
        <ReleaseDates dates={film.release_dates} />
        <FilmPlot overview={film.overview} />
        <FilmCredits cast={film.cast} />
        <FilmCrew crew={film.crew} />
        <ProductionCompanies companies={film.production_companies} />
        <EventTimeline dayGroups={film.day_groups} />
      </div>
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
      <p className="mt-2 text-sm text-muted-foreground">
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
