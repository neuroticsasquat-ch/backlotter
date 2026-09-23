/* eslint-disable react-refresh/only-export-components -- route files intentionally export loader + meta + ErrorBoundary alongside the component */
import { isRouteErrorResponse, Link, redirect } from "react-router";
import type { Route } from "./+types/person";
import { EMPTY_ACTIVITY, getEntityEvents, getPerson } from "@/api/public";
import { cloudflareContext } from "@/lib/load-context";
import { ssrOriginHeaders } from "@/lib/ssr-origin";
import { buildMeta } from "@/lib/seo";
import { profileUrl } from "@/lib/poster";
import { formatEventDate } from "@/lib/format";
import type { FollowTarget } from "@/lib/film-entities";
import { PersonFollowControl } from "@/components/follow/PersonFollowControl";
import { EntityActivitySection } from "@/components/entity/EntityActivity";
import { EntityFilmSection } from "@/components/entity/EntityFilmRow";
import { PersonFilmRow } from "@/components/person/PersonFilmRow";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const headers = ssrOriginHeaders(env, request);
  // In parallel, not in sequence: the two routes 404 on identical terms, so the detail fetch
  // still owns that decision and the activity fetch costs nothing but a wasted request on the
  // rare ref that redirects. `?? EMPTY_ACTIVITY` covers only the skew where one resolved and
  // the other did not — a page with no cards is a normal page, not an error.
  const [person, activity] = await Promise.all([
    getPerson(env.API_BASE_URL, params.ref, { headers }),
    getEntityEvents(env.API_BASE_URL, "person", params.ref, { headers }),
  ]);
  if (!person) {
    throw new Response(null, { status: 404, statusText: "Person not found" });
  }
  // The same canonical-ref rule the film page runs, for the same reason: a ref resolves on its
  // leading id, so a bare id and a ref built from a name TMDB has since corrected both reach
  // this person. 301 rather than 302 — these URLs are linked from every film page's credits,
  // and a permanent redirect is what moves the ranking signal onto the one we now emit.
  if (params.ref !== person.ref) {
    const url = new URL(request.url);
    url.pathname = `/person/${person.ref}`;
    throw redirect(url.toString(), 301);
  }
  return { person, activity: activity ?? EMPTY_ACTIVITY };
}

export function meta({ loaderData, location }: Route.MetaArgs): Route.MetaDescriptors {
  if (!loaderData?.person) {
    return [
      ...buildMeta({ title: "Person not found", pathname: location.pathname }),
      { name: "robots", content: "noindex" },
    ];
  }
  const { person } = loaderData;
  const upcoming = person.upcoming.length;
  const description = upcoming
    ? `${upcoming} upcoming ${upcoming === 1 ? "film" : "films"} for ${person.name}, with release dates and every credit we track.`
    : `Release dates and recent credits for ${person.name}.`;
  return buildMeta({
    title: person.name,
    description,
    pathname: location.pathname,
    image: profileUrl(person.profile_path, "w185") ?? undefined,
    type: "article",
  });
}

/** Born/died, as the header's second line. TMDB carries either, both or neither, and a person
 *  with no dates at all gets no line rather than an empty one. */
function lifespan(birthday: string | null, deathday: string | null): string | null {
  const parts: string[] = [];
  if (birthday) parts.push(`Born ${formatEventDate(birthday)}`);
  if (deathday) parts.push(`Died ${formatEventDate(deathday)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export default function PersonPage({ loaderData }: Route.ComponentProps) {
  const { person, activity } = loaderData;
  const photo = profileUrl(person.profile_path, "w185");
  const dates = lifespan(person.birthday, person.deathday);

  const target: FollowTarget = {
    entityType: "person",
    entityId: String(person.id),
    label: person.name,
    imagePath: person.profile_path,
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="flex gap-4">
        {photo ? (
          <img
            src={photo}
            alt=""
            className="h-28 w-20 flex-none rounded object-cover sm:h-36 sm:w-24"
          />
        ) : (
          <div
            aria-hidden="true"
            className="h-28 w-20 flex-none rounded bg-muted sm:h-36 sm:w-24"
          />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold text-foreground">{person.name}</h1>
          {person.known_for_department && (
            <p className="mt-0.5 text-sm text-muted-foreground">{person.known_for_department}</p>
          )}
          {dates && <p className="mt-0.5 text-xs text-muted-foreground">{dates}</p>}
          <div className="mt-3">
            <PersonFollowControl target={target} />
          </div>
        </div>
      </header>

      {/* Two sections and nothing else: between them they are exactly what a follow can reach
          (D-46), so the page shows the reader what following this person would deliver rather
          than a filmography stretching back thirty years. */}
      <EntityFilmSection
        heading="Upcoming"
        count={person.upcoming.length}
        empty="No upcoming films in the catalog"
      >
        {person.upcoming.map((row) => (
          <PersonFilmRow key={row.film.id} row={row} />
        ))}
      </EntityFilmSection>
      <EntityFilmSection
        heading="Recently released"
        count={person.recent.length}
        empty="No recent releases"
      >
        {person.recent.map((row) => (
          <PersonFilmRow key={row.film.id} row={row} />
        ))}
      </EntityFilmSection>
      {/* Under the film lists (EF-18): the lists say which films a follow reaches, this says
          what it would actually have put in front of the reader. */}
      <EntityActivitySection kind="person" entityRef={person.ref} initial={activity} />
    </main>
  );
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">
        {isNotFound ? "Person not found" : "Something went wrong"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {isNotFound
          ? "We couldn't find that person. They may have moved or never existed."
          : "Please try again in a moment."}
      </p>
      <Link to="/" className="mt-6 inline-block text-sm text-blue-600 underline">
        Back to home
      </Link>
    </main>
  );
}
