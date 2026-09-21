/* eslint-disable react-refresh/only-export-components -- route files intentionally export loader + meta + ErrorBoundary alongside the component */
import { isRouteErrorResponse, redirect } from "react-router";
import type { Route } from "./+types/franchise";
import { getCollection } from "@/api/public";
import { cloudflareContext } from "@/lib/load-context";
import { ssrOriginHeaders } from "@/lib/ssr-origin";
import { buildMeta } from "@/lib/seo";
import { posterUrl } from "@/lib/poster";
import { entityPageDescription } from "@/lib/entity-page";
import { EntityNotFound, EntityPage } from "@/components/entity/EntityPage";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  // `/collections/{ref}` upstream, `/franchise/:ref` here: the backend keeps TMDB's word for
  // the thing and the reader never sees it (EF-19).
  const collection = await getCollection(env.API_BASE_URL, params.ref, {
    headers: ssrOriginHeaders(env, request),
  });
  if (!collection) {
    throw new Response(null, { status: 404, statusText: "Franchise not found" });
  }
  // The studio page's canonical-ref rule, for the same reason — see `routes/studio.tsx`.
  if (params.ref !== collection.ref) {
    const url = new URL(request.url);
    url.pathname = `/franchise/${collection.ref}`;
    throw redirect(url.toString(), 301);
  }
  return { collection };
}

export function meta({ loaderData, location }: Route.MetaArgs): Route.MetaDescriptors {
  if (!loaderData?.collection) {
    return [
      ...buildMeta({ title: "Franchise not found", pathname: location.pathname }),
      { name: "robots", content: "noindex" },
    ];
  }
  const { collection } = loaderData;
  return buildMeta({
    title: collection.name,
    description: entityPageDescription("franchise", collection.name, collection.upcoming.length),
    pathname: location.pathname,
    image: posterUrl(collection.poster_path, "w185") ?? undefined,
    type: "article",
  });
}

export default function FranchisePage({ loaderData }: Route.ComponentProps) {
  const { collection } = loaderData;
  return (
    <EntityPage
      kind="franchise"
      subject={{
        id: collection.id,
        name: collection.name,
        imagePath: collection.poster_path,
        upcoming: collection.upcoming,
        recent: collection.recent,
      }}
    />
  );
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return (
    <EntityNotFound
      kind="franchise"
      isNotFound={isRouteErrorResponse(error) && error.status === 404}
    />
  );
}
