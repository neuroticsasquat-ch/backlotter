import { useState } from "react";
import { Link } from "react-router";

import * as authApi from "@/api/auth";
import { useAuth } from "./AuthContext";

/** Dismissal lives in `sessionStorage`, not `localStorage`: the nudge should come back next
 *  time the user opens the site, but not once per navigation within a visit. */
const DISMISSED_KEY = "backlotter:verify-banner-dismissed";

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). Showing the banner is the
    // safe failure: it is a nudge, and it stays dismissible for the life of the component.
    return false;
  }
}

function writeDismissed(): void {
  try {
    sessionStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Ignore — the in-memory state below still hides the banner for this page view.
  }
}

/**
 * Nudges a signed-in user with an unconfirmed address to verify it.
 *
 * Renders nothing when signed out or already verified, which is what keeps it safe to mount
 * unconditionally in the SPA layout rather than threading it through each authed page.
 * Verification gates outbound mail only (D-18) — the account keeps full access — so this is
 * worded as a prompt, not a warning, and it is dismissible.
 */
export function VerifyEmailBanner() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [resent, setResent] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sending, setSending] = useState(false);

  if (!user || user.email_verified || dismissed) return null;

  async function onResend() {
    if (!user) return;
    setSending(true);
    setFailed(false);
    try {
      await authApi.requestVerification({ email: user.email });
      setResent(true);
    } catch {
      // The route answers 202 for every address, so reaching here means the request never
      // landed. Hiding *that* would be a lie about our own availability, not the discretion
      // the uniform 202 exists to provide.
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      role="status"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
    >
      <div className="mx-auto flex max-w-5xl items-center gap-3">
        <p className="flex-1">
          {resent ? (
            <>Sent — check {user.email} for the confirmation link.</>
          ) : (
            <>
              Confirm your email address so we can send you alerts.{" "}
              <Link to="/verify" className="underline">
                How this works
              </Link>
              {failed && <span className="ml-2">Couldn't send just now — try again.</span>}
            </>
          )}
        </p>
        {!resent && (
          <button
            type="button"
            onClick={onResend}
            disabled={sending}
            className="underline disabled:opacity-50"
          >
            {sending ? "Sending…" : "Resend"}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            writeDismissed();
            setDismissed(true);
          }}
          aria-label="Dismiss"
          className="px-1 text-amber-700 hover:text-amber-900"
        >
          ×
        </button>
      </div>
    </div>
  );
}

export default VerifyEmailBanner;
