import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { ApiError } from "@/api/client";
import { useAuth } from "@/components/AuthContext";
import { Turnstile } from "@/components/Turnstile";
import { Input } from "@/components/ui/input";
import { SITE_NAME } from "@/lib/seo";

/** The `detail` string the API puts on every error body it raises deliberately. */
function detailOf(err: ApiError): string | null {
  const body = err.body;
  if (body && typeof body === "object" && "detail" in body && typeof body.detail === "string") {
    return body.detail;
  }
  return null;
}

/** `retry_after` off a 429 body, rendered the way a person would say it. */
function retryHint(err: ApiError): string {
  const body = err.body;
  const seconds =
    body &&
    typeof body === "object" &&
    "retry_after" in body &&
    typeof body.retry_after === "number"
      ? body.retry_after
      : null;
  if (seconds === null) return "in a little while";
  if (seconds < 60) return `in ${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * Shown both when the widget reports itself unavailable and when a submit is attempted while
 * it still is. One string, because the second case must not silently downgrade to "complete
 * the check below" and point at a widget that was never rendered.
 */
const WIDGET_UNAVAILABLE_MESSAGE =
  "The bot check couldn't load, so signup can't continue. Disable any ad blocker for this page and reload.";

export function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(() => params.get("email") ?? "");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState(() => params.get("invite") ?? "");
  // An `?invite=` link is someone being handed a comp code: open the field for them rather
  // than pre-filling something they'd have to go looking for to see.
  const [inviteOpen, setInviteOpen] = useState(() => params.has("invite"));
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [widgetUnavailable, setWidgetUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Bumped on every failed attempt to remount <Turnstile> — siteverify spends the token, so
  // a retry with the one already in hand would be refused as a replay.
  const [challenge, setChallenge] = useState(0);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (!turnstileToken) {
      setError(
        widgetUnavailable
          ? WIDGET_UNAVAILABLE_MESSAGE
          : "Please complete the “I'm not a robot” check below.",
      );
      return;
    }
    setSubmitting(true);
    try {
      await signup({
        email,
        password,
        displayName,
        turnstileToken,
        inviteCode: inviteCode.trim() || undefined,
      });
      // M3's onboarding takes over this landing at `/welcome` (D-17); until it exists the
      // new account goes straight to the feed.
      navigate("/");
      return;
    } catch (err) {
      if (err instanceof ApiError) {
        const detail = detailOf(err);
        if (err.status === 403 && detail === "invalid_invite") {
          // With SIGNUP_OPEN off the API raises this for a caller who supplied no code at
          // all, so the message has to ask for one rather than blame one they never typed.
          if (inviteCode.trim()) {
            setError("That invite code is invalid, already used, or doesn't match this email.");
          } else {
            setError("Signups are invite-only right now. Enter the invite code you were sent.");
            setInviteOpen(true);
          }
        } else if (err.status === 403) {
          setError("That bot check didn't go through. Please try it again.");
        } else if (err.status === 409) {
          setError("This email is already registered.");
        } else if (err.status === 422) {
          setError("Please check your input and try again.");
        } else if (err.status === 429) {
          setError(
            `Too many signup attempts from your network. Please try again ${retryHint(err)}.`,
          );
        } else if (err.status === 503) {
          setError("Signups are briefly unavailable. Please try again in a few minutes.");
        } else {
          setError("Something went wrong. Please try again.");
        }
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
    // Only reached on failure — the happy path returned above and is navigating away.
    setTurnstileToken(null);
    setWidgetUnavailable(false);
    setChallenge((n) => n + 1);
  }

  return (
    <div className="mx-auto max-w-sm py-12">
      <h1 className="text-2xl font-semibold mb-6">Create your {SITE_NAME} account</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm">
            Email
          </label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-describedby="email-help"
            className="mt-1"
          />
          <p id="email-help" className="text-xs text-gray-500 mt-1">
            Your email won't be shown to other users.
          </p>
        </div>
        <div>
          <label htmlFor="display_name" className="block text-sm">
            Username
          </label>
          <Input
            id="display_name"
            type="text"
            required
            maxLength={100}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            aria-describedby="display-name-help"
            className="mt-1"
          />
          <p id="display-name-help" className="text-xs text-gray-500 mt-1">
            This is the name other users will see on the site.
          </p>
        </div>
        <div>
          <label htmlFor="password" className="block text-sm">
            Password
          </label>
          <Input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1"
          />
          <p className="text-xs text-gray-500 mt-1">At least 8 characters.</p>
        </div>
        <div>
          <button
            type="button"
            onClick={() => setInviteOpen((open) => !open)}
            aria-expanded={inviteOpen}
            aria-controls="invite-code-field"
            className="text-sm text-gray-600 underline"
          >
            Have an invite code?
          </button>
          {inviteOpen && (
            <div id="invite-code-field" className="mt-2">
              <label htmlFor="invite_code" className="block text-sm">
                Invite code
              </label>
              <Input
                id="invite_code"
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                aria-describedby="invite-code-help"
                className="mt-1"
                autoComplete="off"
              />
              <p id="invite-code-help" className="text-xs text-gray-500 mt-1">
                Optional — anyone can sign up. A code just links your account to whoever sent it.
              </p>
            </div>
          )}
        </div>
        <Turnstile
          key={challenge}
          onToken={setTurnstileToken}
          onUnavailable={() => {
            setWidgetUnavailable(true);
            setError(WIDGET_UNAVAILABLE_MESSAGE);
          }}
        />
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-black text-white py-2 disabled:opacity-50"
        >
          {submitting ? "Creating account…" : "Sign up"}
        </button>
      </form>
      <p className="mt-4 text-sm">
        Already have an account?{" "}
        <Link to="/login" className="underline">
          Log in
        </Link>
      </p>
    </div>
  );
}

export default Signup;
