import { Outlet } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Sentry from "@sentry/react";
import { Toaster } from "sonner";
import { AuthProvider } from "@/components/AuthContext";
import { GlobalHeader } from "@/components/layout/GlobalHeader";
import { GlobalFooter } from "@/components/layout/GlobalFooter";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

// No server loader → this subtree is client-only. The server renders HydrateFallback;
// the client runs clientLoader on hydration, then mounts the providers + routes.
/* eslint-disable-next-line react-refresh/only-export-components -- route files intentionally export loader + meta alongside the component */
export async function clientLoader() {
  return null;
}
clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return null;
}

export default function SpaLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {/* Same chrome as the public site (header + footer + branding) so login,
            signup, and admin pages match the rest of the site. */}
        <div className="flex min-h-screen flex-col">
          <GlobalHeader />
          <main className="flex-1">
            <Sentry.ErrorBoundary
              fallback={<div>Something went wrong. Please refresh the page.</div>}
            >
              <Outlet />
            </Sentry.ErrorBoundary>
          </main>
          <GlobalFooter />
        </div>
        <Toaster position="bottom-center" richColors closeButton />
      </AuthProvider>
    </QueryClientProvider>
  );
}
