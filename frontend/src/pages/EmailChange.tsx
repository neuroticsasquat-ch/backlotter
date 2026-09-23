import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import * as authApi from "@/api/auth";
import { ApiError } from "@/api/client";
import { useAuth } from "@/components/AuthContext";

type Outcome = "confirming" | "changed" | "invalid" | "in-use" | "failed" | "no-token";

/**
 * Land the `/email-change?token=` link from the mail sent to a new address (NEU-1341).
 *
 * Built like `/verify`: the token is spent on mount, because opening the link is the intent,
 * and the effect is guarded against firing twice because the token is single-use. The two
 * differ in who arrives — this link lands in an inbox that could not sign in to the account
 * yet, so the page assumes nothing about the session. A signed-in owner gets their account
 * re-read so the new address shows; anyone else is told to sign in with it.
 */
export function EmailChange() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const { user, refresh } = useAuth();
  const [outcome, setOutcome] = useState<Outcome>(token ? "confirming" : "no-token");
  const consumed = useRef(false);

  useEffect(() => {
    if (!token || consumed.current) return;
    consumed.current = true;
    let cancelled = false;
    (async () => {
      try {
        await authApi.confirmEmailChange({ token });
        if (!cancelled) setOutcome("changed");
        // The session survives a change of address (the backend says so), so this is what
        // swaps the old email for the new one everywhere the account is shown.
        await refresh();
      } catch (err) {
        if (cancelled) return;
        // Only a 400 means the link itself is dead, and a 409 that the address was taken in
        // the meantime; anything else is ours or the network's, and the token is still good.
        if (err instanceof ApiError && err.status === 400) setOutcome("invalid");
        else if (err instanceof ApiError && err.status === 409) setOutcome("in-use");
        else setOutcome("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, refresh]);

  const settingsLink = (
    <p className="mt-4 text-sm">
      <Link to="/me/settings" className="underline">
        Back to settings
      </Link>
    </p>
  );

  if (outcome === "confirming") {
    return (
      <div className="mx-auto max-w-sm py-12">
        <h1 className="text-2xl font-semibold mb-4">Confirming your new address…</h1>
      </div>
    );
  }

  if (outcome === "changed") {
    return (
      <div className="mx-auto max-w-sm py-12">
        <h1 className="text-2xl font-semibold mb-4">Address changed</h1>
        <p className="text-sm">
          {user ? (
            <>
              Your account now uses <strong>{user.email}</strong>.
            </>
          ) : (
            "Your account now uses this address. Sign in with it from now on."
          )}
        </p>
        {user ? (
          settingsLink
        ) : (
          <p className="mt-4 text-sm">
            <Link to="/login" className="underline">
              Log in
            </Link>
          </p>
        )}
      </div>
    );
  }

  if (outcome === "in-use") {
    return (
      <div className="mx-auto max-w-sm py-12">
        <h1 className="text-2xl font-semibold mb-4">That address is already in use</h1>
        <p className="text-sm">
          Another account took it after we sent you the link, so nothing has changed. Pick a
          different address from your settings.
        </p>
        {settingsLink}
      </div>
    );
  }

  if (outcome === "failed") {
    return (
      <div className="mx-auto max-w-sm py-12">
        <h1 className="text-2xl font-semibold mb-4">Something went wrong</h1>
        <p className="text-sm">
          We couldn&apos;t reach the server to confirm your address. Your link has not been used —
          open it again in a moment.
        </p>
        {settingsLink}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm py-12">
      <h1 className="text-2xl font-semibold mb-4">That link didn&apos;t work</h1>
      <p className="text-sm">
        {outcome === "invalid"
          ? "Confirmation links expire and can only be used once. Ask for a new one from your settings."
          : "This page needs the link from the confirmation mail. Ask for one from your settings."}
      </p>
      {settingsLink}
    </div>
  );
}

export default EmailChange;
