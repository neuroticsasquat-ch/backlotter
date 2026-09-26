import { useId, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { useAuth } from "@/components/AuthContext";
import { Button } from "@/components/ui/button";
import { useTimelineHint } from "@/lib/timeline-hint";

/** What the viewer may do with a follow button (D-41). Three resolved states, not two: an
 *  account that has not been granted access is signed in and can see exactly what it is missing.
 *
 *  The fourth, `hinted`, is a wait rather than an answer: no account yet, but the timeline hint
 *  predicts a `ready` one and `/me` is in flight (NEU-1468, D-1468.4). Only the home page and the
 *  nav act on it; every other surface treats it as `anonymous` until the account resolves. */
export type FollowAccess = "anonymous" | "hinted" | "locked" | "ready";

/** Says what access is missing without pretending there is a way to buy it — there is not,
 *  until *bl: Subscription & Billing* ships (D-41). */
export const LOCKED_COPY =
  "Following is part of the subscription. Access is limited while we build that tier.";

/**
 * What following a film actually gets you, said on the film page where the choice is made.
 *
 * It describes the film's own follow and nothing else, which is now the only follow this page
 * offers (EF-16). It used to have to hedge — a film could arrive on the reader's surfaces
 * through a director they followed, so "following a film" was one of several ways to hear
 * about it. An entity follow delivers that entity's attachment stream and nothing more
 * (EF-3), so the sentence can be flat.
 *
 * Beside {@link LOCKED_COPY} because the two share a row and must not fight. This one is
 * **ordinary text under the control**, never a `title` or an `aria-describedby`: a disabled
 * locked button already owns its tooltip, and a second one on the same control is a trap.
 * Plain text also means it reads in every access state, including the anonymous one — the
 * visitor who has not signed in is exactly who needs to be told what the button is for.
 */
export const FOLLOW_CUE =
  "Following a film puts its news in your timeline and tells you when it gets a date, moves, or turns up to watch at home.";

// The hook and its copy belong beside the two states they describe, as `useAuth` does in
// AuthContext.
// eslint-disable-next-line react-refresh/only-export-components -- hook beside its components
export function useFollowAccess(): FollowAccess {
  const { user, resolving } = useAuth();
  const hint = useTimelineHint();
  // A cached account wins over the hint, whatever it says.
  if (user) return user.entitled ? "ready" : "locked";
  // No account is also what the server render and the first client paint see, because the
  // account query never resolves during SSR — the buttons swap to their signed-in state with
  // the rest of the account UI, not before it. The hint only says what to show meanwhile, and
  // only while a read is actually in flight: one that failed or answered 401 is anonymous.
  return hint && resolving ? "hinted" : "anonymous";
}

/** The anonymous state: the same button, pointing at the sign-in it needs first. `next` is the
 *  page the visitor is on, so they land back on the film they were reading. */
export function SignInToggle({ label, name }: { label: string; name: string }) {
  const { pathname, search } = useLocation();
  return (
    <Button asChild size="sm" variant="outline">
      <Link to={`/login?next=${encodeURIComponent(pathname + search)}`} aria-label={name}>
        {label}
      </Link>
    </Button>
  );
}

/** The locked state: disabled rather than hidden, so someone deciding whether they want a
 *  subscription can see what it would give them (D-41).
 *
 *  The explanation rides on a native `title` on the wrapper, not on the button: a disabled
 *  button takes no pointer events (`disabled:pointer-events-none` on the variant), so a
 *  tooltip hung on it never opens. It is repeated as an `aria-describedby` target because a
 *  `title` alone is not reliably announced. */
export function LockedToggle({ label, name }: { label: string; name: string }) {
  const describedBy = useId();
  return (
    <span title={LOCKED_COPY} className="inline-flex">
      <Button size="sm" variant="outline" disabled aria-label={name} aria-describedby={describedBy}>
        {label}
      </Button>
      <span id={describedBy} className="sr-only">
        {LOCKED_COPY}
      </span>
    </span>
  );
}

/**
 * The full-page counterpart to {@link LockedToggle}: what a signed-in account without a grant
 * is shown *instead of* a subscriber surface, rather than beside one (D-41).
 *
 * The heading and the explanation are the caller's, because they are the honest part — a
 * locked `/me/follows` and a locked `/welcome` are missing different things and saying "your
 * follows are not open yet" on the onboarding route would not tell the user what they came
 * for. The shell and the way out are shared: every locked panel ends by offering the public
 * feed, which is the one thing the account can still do.
 */
export function LockedPanel({ heading, children }: { heading: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <div className="mx-auto max-w-3xl p-8">
      <section
        aria-labelledby={headingId}
        className="rounded-lg border border-border bg-muted/40 p-6"
      >
        <h1 id={headingId} className="text-lg font-semibold text-foreground">
          {heading}
        </h1>
        {children}
        <p className="mt-4 text-sm">
          <Link to="/feed" className="underline underline-offset-4 hover:text-foreground">
            Browse everything we track
          </Link>
        </p>
      </section>
    </div>
  );
}
