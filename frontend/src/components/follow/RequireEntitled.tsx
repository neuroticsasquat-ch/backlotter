import { Link, Outlet } from "react-router";
import { useFollowAccess } from "./access";

/**
 * The entitlement gate for the account pages, as a layout route beside `RequireAuth` and
 * `RequireAdmin` (the repo's guards are routes, not JSX wrappers).
 *
 * It renders rather than redirects, which is the whole point of D-41: an account that has not
 * been granted access must be told what it is missing, not bounced to a page that does not
 * explain itself and not shown an empty list it would read as "you follow nothing". The
 * follows and watchlist rows are still there on the server — revocation suppresses and never
 * destroys (D-40) — so the honest copy is "not open yet", not "empty".
 *
 * Nests under `RequireAuth`, so `useFollowAccess` can only answer `locked` or `ready` here;
 * the `anonymous` branch is what the guard above has already redirected away.
 */
export function RequireEntitled() {
  const access = useFollowAccess();
  if (access === "ready") return <Outlet />;
  return <LockedAccountPanel />;
}

function LockedAccountPanel() {
  return (
    <div className="mx-auto max-w-3xl p-8">
      <section
        aria-labelledby="locked-account-heading"
        className="rounded-lg border border-border bg-muted/40 p-6"
      >
        <h1 id="locked-account-heading" className="text-lg font-semibold text-foreground">
          Your follows are not open yet
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Following people, studios and collections — and the watchlist that builds itself from them
          — is part of the subscription. Access is limited while we build that tier, so there is
          nothing to buy yet.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Anything you have followed before is kept. If your access is restored, your follows and
          watchlist come back exactly as you left them.
        </p>
        <p className="mt-4 text-sm">
          <Link to="/feed" className="underline underline-offset-4 hover:text-foreground">
            Browse everything we track
          </Link>
        </p>
      </section>
    </div>
  );
}

export default RequireEntitled;
