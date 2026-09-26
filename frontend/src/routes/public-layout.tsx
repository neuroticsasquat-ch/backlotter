import { Outlet } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AuthProvider } from "@/components/AuthContext";
import { GlobalHeader } from "@/components/layout/GlobalHeader";
import { GlobalFooter } from "@/components/layout/GlobalFooter";
import { SearchBox } from "@/components/search/SearchBox";
import { readTimelineHint, TimelineHintContext } from "@/lib/timeline-hint";
import type { Route } from "./+types/public-layout";

// Module-level QueryClient for the public layout. SSR-safe by the same invariant as
// HeaderAccount's account island: the `["me"]` query never resolves during the server
// render pass, so no user-specific data is cached server-side and the first client paint
// is the logged-out default (no hydration mismatch). The timeline hint below picks which
// logged-out shell that is, and the server and client read it from the same loader data. `refetchOnMount: "always"` keeps
// auth state fresh when navigating back from the SPA shell where login happens.
// eslint-disable-next-line react-refresh/only-export-components -- shared singleton, not a component
export const publicQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnMount: "always",
    },
  },
});

/**
 * Reads the timeline hint off the request and nothing else — no fetch, and no auth: the hint is
 * the browser's own prediction, not a session (NEU-1468, D-1468.3). It runs on the document
 * request and on every client navigation *into* this subtree, which is what lets the landing
 * after `/login` render the timeline skeleton; navigations within the subtree keep the answer,
 * because `["me"]` is warm by then and outranks it.
 */
// eslint-disable-next-line react-refresh/only-export-components -- route module: loader beside its component
export function loader({ request }: Route.LoaderArgs) {
  return { timelineHint: readTimelineHint(request.headers.get("Cookie")) };
}

/**
 * Public shell: GlobalHeader (sticky wordmark + nav/account menu), a search bar below
 * the header, the routed page, then GlobalFooter. Search is type-ahead only — picking a
 * result navigates straight to that film page (there is no search results page).
 *
 * Wraps the subtree in QueryClient + Auth providers (so page content like the film
 * timeline's admin delink controls can read `useAuth`) and mounts the sonner Toaster.
 *
 * `loaderData` is optional only for tests that mount the layout under a plain router; without it
 * the hint falls back to the browser's cookie jar (`useTimelineHint`).
 */
export default function PublicLayout({
  loaderData,
}: {
  loaderData?: Route.ComponentProps["loaderData"];
}) {
  return (
    <QueryClientProvider client={publicQueryClient}>
      <TimelineHintContext value={loaderData?.timelineHint}>
        <AuthProvider>
          <div className="flex min-h-screen flex-col">
            <GlobalHeader />
            <div className="border-b border-border">
              <div className="mx-auto max-w-3xl px-4 py-3">
                <SearchBox />
              </div>
            </div>
            <main className="flex-1">
              <Outlet />
            </main>
            <GlobalFooter />
          </div>
          <Toaster position="bottom-center" richColors closeButton />
        </AuthProvider>
      </TimelineHintContext>
    </QueryClientProvider>
  );
}
