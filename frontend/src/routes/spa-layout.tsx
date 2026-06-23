import { Outlet } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Sentry from "@sentry/react";
import { Toaster } from "sonner";
import { AuthProvider } from "@/components/AuthContext";

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
        <Sentry.ErrorBoundary fallback={<div>Something went wrong. Please refresh the page.</div>}>
          <Outlet />
        </Sentry.ErrorBoundary>
        <Toaster position="bottom-center" richColors closeButton />
      </AuthProvider>
    </QueryClientProvider>
  );
}
