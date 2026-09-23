import { useId } from "react";
import { Button } from "@/components/ui/button";
import { usePushToggle } from "./usePushToggle";

/**
 * "Browser notifications" on `/me/settings` (D-36, NEU-1388).
 *
 * Three outcomes, kept apart on purpose:
 *
 * - **supported** — the toggle, which asks for permission from the click itself.
 * - **needs-install** — an iPhone in a tab. This is an *install funnel*, not a dead end: iOS
 *   exposes the push APIs only to an installed web app, and there is no `beforeinstallprompt`
 *   on iOS, so written steps are the only affordance that exists. Telling this user their
 *   browser cannot do it would be false — it can, one Add to Home Screen away.
 * - **unsupported** — genuinely nothing to offer, which is a different sentence.
 *
 * The distinction is the same one the timeline draws between "no follows yet" and "no access
 * yet": an empty state that the user can act on must not be dressed as one they cannot.
 */
export function PushSection({ className }: { className?: string }) {
  const headingId = useId();
  const { phase, support, permission, subscribed, error, enable, disable } = usePushToggle();

  return (
    <section aria-labelledby={headingId} className={className}>
      <h2 id={headingId} className="text-lg font-semibold text-foreground">
        Browser notifications
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Trailer drops and release-date changes for what you follow, on this device. Each device you
        want them on has to be turned on separately.
      </p>

      {phase === "checking" && <p className="mt-3 text-sm text-muted-foreground">Checking…</p>}

      {support === "needs-install" && <InstallSteps />}
      {support === "unsupported" && (
        <p className="mt-4 text-sm text-muted-foreground">
          This browser does not support push notifications. Your digest email and calendar
          subscription still work everywhere — and notifications will be here if you open the site
          in a browser that supports them.
        </p>
      )}

      {support === "supported" && (
        <div className="mt-4">
          {permission === "denied" ? (
            <p className="text-sm text-muted-foreground">
              Notifications are blocked for this site. Turn them back on in your browser settings,
              then reload this page.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant={subscribed ? "destructive" : "default"}
                disabled={phase === "working"}
                // The permission prompt has to come out of this click (iOS rejects it
                // otherwise), so the handler calls it before it awaits anything.
                onClick={subscribed ? disable : enable}
              >
                {subscribed ? "Turn off notifications" : "Turn on notifications"}
              </Button>
              <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
                {phase === "working"
                  ? "Working…"
                  : subscribed
                    ? "On for this device."
                    : "Off for this device."}
              </span>
            </div>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * The iOS install funnel.
 *
 * Written as instructions because iOS gives a page no way to offer the install itself: there
 * is no `beforeinstallprompt`, and Add to Home Screen lives in the Share sheet where only the
 * user can reach it. The last step matters as much as the first — a Home Screen icon that is
 * opened from Safari rather than tapped is still a tab, and push stays unavailable.
 */
function InstallSteps() {
  return (
    <div className="mt-4 text-sm">
      <p className="text-foreground">
        On iPhone and iPad, notifications work once backlotter is installed to your Home Screen. It
        takes a moment:
      </p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-muted-foreground">
        <li>
          Tap the <strong className="font-medium text-foreground">Share</strong> button in the
          browser toolbar.
        </li>
        <li>
          Choose <strong className="font-medium text-foreground">Add to Home Screen</strong>, then
          Add.
        </li>
        <li>Open backlotter from the new Home Screen icon, not from your browser.</li>
        <li>Come back to this page and turn notifications on.</li>
      </ol>
      <p className="mt-3 text-xs text-muted-foreground">
        Your digest email and calendar subscription work either way — installing is only needed for
        notifications.
      </p>
    </div>
  );
}
