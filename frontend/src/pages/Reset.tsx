import { useState } from "react";
import { Link, useSearchParams } from "react-router";

import * as authApi from "@/api/auth";
import { ApiError } from "@/api/client";
import { useAuth } from "@/components/AuthContext";
import { Input } from "@/components/ui/input";

/** Mirror `PasswordResetConsumeRequest.new_password` on the backend; the reset flow must not
 *  be the weakest of the three ways a password gets set, and a passphrase over the cap should
 *  be caught here rather than come back as an opaque 422. */
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

/**
 * Land the `/reset?token=` link from the reset mail and set a new password.
 *
 * `POST /auth/reset` spends the token, sets the password and drops every session the account
 * has — including, potentially, this browser's. It deliberately does not sign the caller in,
 * so the only honest ending here is "now log in".
 */
export function Reset() {
  const [params] = useSearchParams();
  const { refresh } = useAuth();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      setError(`Password must be at most ${MAX_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await authApi.resetPassword({ token, new_password: password });
      setDone(true);
      // The backend drops *every* session for the account, this browser's included. Without
      // this the cached `["me"]` (60s) and the in-memory CSRF token would keep the header and
      // the verify banner showing a signed-in user whose next request 401s for no visible
      // reason. Re-reading `/me` is also the safe move in the case the backend's own docstring
      // worries about — a reset link opened in a browser signed in as somebody else.
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError("That reset link is invalid or has expired. Ask for a new one.");
      } else if (err instanceof ApiError && err.status === 422) {
        setError("Please check your input and try again.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className="mx-auto max-w-sm py-12">
        <h1 className="text-2xl font-semibold mb-4">That link is incomplete</h1>
        <p className="text-sm">
          This page needs the reset link from your email. Open the link again, or{" "}
          <Link to="/forgot" className="underline">
            ask for a new one
          </Link>
          .
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="mx-auto max-w-sm py-12">
        <h1 className="text-2xl font-semibold mb-4">Password updated</h1>
        <p className="text-sm">
          Your new password is set. For safety we signed you out on every device, including this
          one, so log in again to continue.
        </p>
        <p className="mt-4 text-sm">
          <Link to="/login" className="underline">
            Log in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm py-12">
      <h1 className="text-2xl font-semibold mb-6">Set a new password</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="password" className="block text-sm">
            New password
          </label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={MAX_PASSWORD_LENGTH}
            autoComplete="new-password"
            className="mt-1"
          />
          <p className="text-xs text-gray-500 mt-1">At least {MIN_PASSWORD_LENGTH} characters.</p>
        </div>
        <div>
          <label htmlFor="confirm_password" className="block text-sm">
            Confirm new password
          </label>
          <Input
            id="confirm_password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
            className="mt-1"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-black text-white py-2 disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Set new password"}
        </button>
      </form>
      <p className="mt-4 text-sm">
        <Link to="/forgot" className="underline">
          Request a new reset link
        </Link>
      </p>
    </div>
  );
}

export default Reset;
