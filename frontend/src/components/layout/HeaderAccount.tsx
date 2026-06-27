import { Link } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/components/AuthContext";

// Module-level QueryClient for the public account island; persists across navigations
// within the public layout.
//
// SSR-safe by invariant: this singleton is shared across SSR requests in the same
// worker isolate, but the `["me"]` query never resolves during the server render pass,
// so no user-specific data is ever cached server-side (unlike spa-layout.tsx, whose
// client never instantiates on the server because that subtree is client-only).
//
// `refetchOnMount: "always"` matters because this island lives in a separate layout
// (and separate QueryClient) from the authed app where login happens. Without it, a
// `me=null` cached here while logged out would stay "fresh" for `staleTime`, so the
// header could keep showing "Log in" after the user authenticated in the SPA shell and
// navigated back. Forcing a refetch on every mount keeps the header in sync; the cold
// cache still yields a synchronous logged-out first paint (no hydration mismatch).
//
// Exported so the singleton-dependent tests can reset it between cases.
// eslint-disable-next-line react-refresh/only-export-components -- shared singleton, not a component
export const accountQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnMount: "always",
    },
  },
});

/**
 * Inner account area component. Consumes `useAuth()` from an externally-supplied
 * `AuthProvider` + `QueryClientProvider`. Exported separately so tests can render
 * it with per-test providers without touching the module-level `moduleClient`.
 *
 * Renders the logged-out default (`!user`) synchronously — no loading skeleton —
 * so the first client paint matches the SSR default (no hydration mismatch).
 */
export function AccountArea({ variant = "menu" }: { variant?: "menu" | "inline" }) {
  const { user, logout } = useAuth();
  // "menu" = stacked rows for the mobile hamburger; "inline" = compact text links for
  // the wide-viewport header row.
  const itemClass =
    variant === "inline"
      ? "text-sm text-muted-foreground transition-colors hover:text-foreground"
      : "block rounded px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground";

  // No public "Log in" link until there's a paid tier — the admin reaches /login directly
  // (and is bounced there by RequireAuth). Anonymous visitors see no account UI at all.
  if (!user) return null;

  return (
    <div
      className={
        variant === "inline"
          ? "flex items-center gap-4 text-sm"
          : "mt-1 flex flex-col border-t border-border pt-1"
      }
    >
      <span
        className={variant === "inline" ? "text-foreground" : "px-3 py-2 text-sm text-foreground"}
      >
        {user.display_name}
      </span>
      {user.is_admin && (
        <Link to="/admin/ingest" className={itemClass}>
          Admin
        </Link>
      )}
      <button
        onClick={() => logout()}
        className={variant === "inline" ? itemClass : `${itemClass} w-full text-left`}
      >
        Log out
      </button>
    </div>
  );
}

/**
 * Self-contained account island. Wraps `QueryClientProvider` + `AuthProvider`
 * around `AccountArea` using the module-level `QueryClient`.
 *
 * Use this as the default export when embedding the island in a page that has
 * no existing React Query or Auth context (e.g. the public site header).
 */
export default function HeaderAccount({ variant }: { variant?: "menu" | "inline" } = {}) {
  return (
    <QueryClientProvider client={accountQueryClient}>
      <AuthProvider>
        <AccountArea variant={variant} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
