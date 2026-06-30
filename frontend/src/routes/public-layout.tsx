import { Outlet } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AuthProvider } from "@/components/AuthContext";
import { GlobalHeader } from "@/components/layout/GlobalHeader";
import { GlobalFooter } from "@/components/layout/GlobalFooter";
import { SearchBox } from "@/components/search/SearchBox";

// Module-level QueryClient for the public layout. SSR-safe by the same invariant as
// HeaderAccount's account island: the `["me"]` query never resolves during the server
// render pass, so no user-specific data is cached server-side and the first client paint
// is the logged-out default (no hydration mismatch). `refetchOnMount: "always"` keeps
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
 * Public shell: GlobalHeader (sticky wordmark + nav/account menu), a search bar below
 * the header, the routed page, then GlobalFooter. Search is type-ahead only — picking a
 * result navigates straight to that film page (there is no search results page).
 *
 * Wraps the subtree in QueryClient + Auth providers (so page content like the film
 * timeline's admin delink controls can read `useAuth`) and mounts the sonner Toaster.
 */
export default function PublicLayout() {
  return (
    <QueryClientProvider client={publicQueryClient}>
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
    </QueryClientProvider>
  );
}
