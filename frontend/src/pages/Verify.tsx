import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import * as authApi from "@/api/auth";
import { ApiError } from "@/api/client";
import { useAuth } from "@/components/AuthContext";
import { Input } from "@/components/ui/input";
import { SITE_NAME } from "@/lib/seo";

type Outcome = "verifying" | "verified" | "invalid" | "failed" | "no-token";

/**
 * Land the `/verify?token=` link from the verification mail.
 *
 * The token is spent on mount rather than behind a button: the user already expressed intent
 * by opening the link, and `POST /auth/verify` answers with no body, so there is nothing to
 * show until it has run. It is single-use, so the effect is guarded against firing twice —
 * React's development double-invoke would otherwise spend the token and then report the
 * replay as an expired link.
 *
 * Reached without a token it becomes the re-send form, which is where the verification mail
 * points when it says the link can expire.
 */
export function Verify() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const { user, loading, refresh } = useAuth();
  const [outcome, setOutcome] = useState<Outcome>(token ? "verifying" : "no-token");
  const consumed = useRef(false);

  useEffect(() => {
    if (!token || consumed.current) return;
    consumed.current = true;
    let cancelled = false;
    (async () => {
      try {
        await authApi.verifyEmail({ token });
        if (!cancelled) setOutcome("verified");
        // A signed-out visitor has no `["me"]` to update; for a signed-in one this is what
        // flips `email_verified` and retires the banner.
        await refresh();
      } catch (err) {
        // Only a 400 means the token itself is dead. Calling a 500 or a dropped connection an
        // expired link would send the user to burn a fresh token when this one is still good.
        const spent = err instanceof ApiError && err.status === 400;
        if (!cancelled) setOutcome(spent ? "invalid" : "failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, refresh]);

  if (outcome === "verifying") {
    return (
      <div className="mx-auto max-w-sm py-12">
        <h1 className="text-2xl font-semibold mb-4">Confirming your email…</h1>
      </div>
    );
  }

  if (outcome === "verified") {
    return (
      <div className="mx-auto max-w-sm py-12">
        <h1 className="text-2xl font-semibold mb-4">Email confirmed</h1>
        <p className="text-sm">
          Thanks — <strong>{SITE_NAME}</strong> can now send you mail about the films you follow.
        </p>
        <p className="mt-4 text-sm">
          <Link to="/" className="underline">
            {user ? "Back to your feed" : "Go to the feed"}
          </Link>
        </p>
      </div>
    );
  }

  if (outcome === "failed") {
    return (
      <div className="mx-auto max-w-sm py-12">
        <h1 className="text-2xl font-semibold mb-4">Something went wrong</h1>
        <p className="text-sm">
          We couldn't reach the server to confirm your email. Your link has not been used — open it
          again in a moment.
        </p>
        <p className="mt-4 text-sm">
          <Link to="/" className="underline">
            Go to the feed
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm py-12">
      <h1 className="text-2xl font-semibold mb-2">
        {outcome === "invalid" ? "That link didn't work" : "Confirm your email"}
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        {outcome === "invalid"
          ? "Verification links expire and can only be used once. Enter your address and we'll send a fresh one."
          : "Enter your address and we'll send you a new confirmation link."}
      </p>
      {/* `/me` resolves after the first paint, so mounting the form before auth settles would
          seed it with a blank address and never correct it — the default is read once. */}
      {loading ? null : <ResendForm defaultEmail={user?.email ?? ""} />}
      <p className="mt-4 text-sm">
        <Link to="/" className="underline">
          Go to the feed
        </Link>
      </p>
    </div>
  );
}

/**
 * Re-send the verification mail. Like the reset request it is answered 202 for every address,
 * so the confirmation below is worded to claim nothing about whether the account exists.
 */
function ResendForm({ defaultEmail }: { defaultEmail: string }) {
  const [email, setEmail] = useState(defaultEmail);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await authApi.requestVerification({ email });
      setSent(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <p className="text-sm">
        If <strong>{email}</strong> needs confirming, a new link is on its way.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm">
          Email
        </label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          className="mt-1"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded bg-black text-white py-2 disabled:opacity-50"
      >
        {submitting ? "Sending…" : "Send a new link"}
      </button>
    </form>
  );
}

export default Verify;
