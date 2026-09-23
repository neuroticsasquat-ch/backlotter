import { useState } from "react";
import { Link } from "react-router";

import * as authApi from "@/api/auth";
import { Input } from "@/components/ui/input";
import { SITE_NAME } from "@/lib/seo";

/**
 * Request a password-reset mail.
 *
 * The backend answers 202 for every address, known or not, so this page cannot tell the
 * caller whether an account exists — and deliberately does not try. Success and "no such
 * account" render the same sentence; a transport failure is the only thing that surfaces an
 * error, because it is the only outcome that says nothing about the address.
 */
export function Forgot() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await authApi.requestPasswordReset({ email });
      setSent(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="mx-auto max-w-sm py-12">
        <h1 className="text-2xl font-semibold mb-4">Check your email</h1>
        <p className="text-sm">
          If an account exists for <strong>{email}</strong>, we've sent it a link to set a new
          password. The link works once and expires.
        </p>
        <p className="mt-4 text-sm">
          <Link to="/login" className="underline">
            Back to log in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm py-12">
      <h1 className="text-2xl font-semibold mb-2">Reset your password</h1>
      <p className="text-sm text-gray-500 mb-6">
        Enter the address on your {SITE_NAME} account and we'll send you a link to set a new
        password.
      </p>
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
          {submitting ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <p className="mt-4 text-sm">
        Remembered it?{" "}
        <Link to="/login" className="underline">
          Log in
        </Link>
      </p>
    </div>
  );
}

export default Forgot;
