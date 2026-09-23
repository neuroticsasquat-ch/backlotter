/* eslint-disable react-refresh/only-export-components -- route files intentionally export loader + meta + ErrorBoundary alongside the component */
import { isRouteErrorResponse, redirect } from "react-router";
import type { Route } from "./+types/studio";
import { EMPTY_ACTIVITY, getCompany, getEntityEvents } from "@/api/public";
import { cloudflareContext } from "@/lib/load-context";
import { ssrOriginHeaders } from "@/lib/ssr-origin";
import { buildMeta } from "@/lib/seo";
import { logoUrl } from "@/lib/poster";
import { entityPageDescription } from "@/lib/entity-page";
import { EntityNotFound, EntityPage } from "@/components/entity/EntityPage";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const headers = ssrOriginHeaders(env, request);
  // Parallel, for the person page's reason: the two routes 404 on identical terms, so the
  // detail fetch still owns that decision and the activity fetch costs only a wasted request
  // on the rare ref that redirects.
  const [company, activity] = await Promise.all([
    getCompany(env.API_BASE_URL, params.ref, { headers }),
    getEntityEvents(env.API_BASE_URL, "company", params.ref, { headers }),
  ]);
  if (!company) {
    throw new Response(null, { status: 404, statusText: "Studio not found" });
  }
  // The person and film pages' canonical-ref rule, for their reason: a ref resolves on its
  // leading id, so a bare id and a ref built from a name TMDB has since corrected both reach
  // this studio. 301 rather than 302 — these URLs are linked from every film page's companies
  // list, and a permanent redirect is what moves the ranking signal onto the one we now emit.
  if (params.ref !== company.ref) {
    const url = new URL(request.url);
    url.pathname = `/studio/${company.ref}`;
    throw redirect(url.toString(), 301);
  }
  return { company, activity: activity ?? EMPTY_ACTIVITY };
}

export function meta({ loaderData, location }: Route.MetaArgs): Route.MetaDescriptors {
  if (!loaderData?.company) {
    return [
      ...buildMeta({ title: "Studio not found", pathname: location.pathname }),
      { name: "robots", content: "noindex" },
    ];
  }
  const { company } = loaderData;
  return buildMeta({
    title: company.name,
    description: entityPageDescription("company", company.name, company.upcoming.length),
    pathname: location.pathname,
    image: logoUrl(company.logo_path, "w185") ?? undefined,
    type: "article",
  });
}

export default function StudioPage({ loaderData }: Route.ComponentProps) {
  const { company, activity } = loaderData;
  return (
    <EntityPage
      kind="company"
      activity={activity}
      subject={{
        id: company.id,
        ref: company.ref,
        name: company.name,
        imagePath: company.logo_path,
        upcoming: company.upcoming,
        recent: company.recent,
      }}
    />
  );
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return (
    <EntityNotFound
      kind="company"
      isNotFound={isRouteErrorResponse(error) && error.status === 404}
    />
  );
}
