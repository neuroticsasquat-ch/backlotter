import { Link, useLocation } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/components/AuthContext";
import { AccountMenu } from "@/components/layout/AccountMenu";

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
  const itemClass =
    "block rounded px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground";

  // The wide-viewport header folds all of this behind one avatar (see `AccountMenu` for
  // why), anonymous visitors included — for them the panel holds the one thing they can do.
  // The stacked rows below are the hamburger's, where a dropdown inside a dropdown would be
  // absurd and the panel has the vertical room to list everything outright.
  if (variant === "inline") return <AccountMenu user={user} onLogout={logout} />;

  // The hamburger's version of the same offer. Previously this rendered nothing at all when
  // logged out, which left the site with no way into it (NEU-1407).
  if (!user) return <AnonymousMenuRows itemClass={itemClass} />;

  return (
    <div className="mt-1 flex flex-col border-t border-border pt-1">
      <span className="px-3 py-2 text-sm text-foreground">{user.display_name}</span>
      {/* Hidden rather than rendered dead for an account without access (D-41): the follow
          buttons on a film page are the surface that argues for the subscription, and they do
          it in context. A nav entry that only ever leads to a locked panel would not. */}
      {user.entitled && (
        <>
          <Link to="/me/follows" className={itemClass}>
            Follows
          </Link>
          {/* The way back into onboarding (D-17). Beside the list it fills rather than
              buried somewhere else, and gated on `entitled` with it: for an account without a
              grant it would only ever reach the locked panel. */}
          <Link to="/welcome" className={itemClass}>
            Redo onboarding
          </Link>
        </>
      )}
      {/* Not gated: the address and password on that page belong to every signed-in
          account, and it is the one place an account without a grant can change them. */}
      <Link to="/me/settings" className={itemClass}>
        Settings
      </Link>
      {user.is_admin && (
        <Link to="/admin/ingest" className={itemClass}>
          Admin
        </Link>
      )}
      <button onClick={() => logout()} className={`${itemClass} w-full text-left`}>
        Log out
      </button>
    </div>
  );
}

/** The hamburger's logged-out rows: `next` so signing in returns the reader to the page
 *  they were on, matching `SignInToggle` on the follow buttons. */
function AnonymousMenuRows({ itemClass }: { itemClass: string }) {
  const { pathname, search } = useLocation();
  return (
    <div className="mt-1 flex flex-col border-t border-border pt-1">
      <Link to={`/login?next=${encodeURIComponent(pathname + search)}`} className={itemClass}>
        Log in
      </Link>
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
