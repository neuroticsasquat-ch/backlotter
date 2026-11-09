import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "@/components/AuthContext";
import { fetchFollows } from "@/api/me";
import type { AuthedUser } from "@/api/types";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/api/client";
import { SITE_NAME } from "@/lib/seo";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(email, password);
      // An explicit `next` is where the visitor was headed before the guard stopped them, and
      // always wins — including over the onboarding landing below.
      navigate(params.get("next") || (await landingFor(user)));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Email or password is incorrect.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm py-12">
      <h1 className="text-2xl font-semibold mb-6">Log in to {SITE_NAME}</h1>
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
            className="mt-1"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm">
            Password
          </label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="mt-1"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-black text-white py-2 disabled:opacity-50"
        >
          {submitting ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p className="mt-4 text-sm">
        <Link to="/forgot" className="underline">
          Forgot your password?
        </Link>
      </p>
      <p className="mt-2 text-sm">
        New here?{" "}
        <Link to="/signup" className="underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}

export default Login;

/**
 * Where a sign-in with no `next` lands.
 *
 * Onboarding, when the account can use it and has never used it: a grant made after signup
 * arrives silently — the user is simply told nothing — so their next sign-in is the only
 * moment the app gets to say "you can set this up now" (NEU-1358). Once the follow graph has
 * anything in it that prompt would be wrong, so this is a one-time landing in practice, not a
 * permanent redirect away from the timeline.
 *
 * Home for everyone else, and for any failure: an unentitled account would only reach
 * `/welcome`'s locked panel, and a follows read that 403s or times out is not a reason to send
 * a reader somewhere they did not ask to go.
 */
async function landingFor(user: AuthedUser): Promise<string> {
  if (!user.entitled) return "/";
  try {
    const { items } = await fetchFollows();
    return items.length === 0 ? "/welcome" : "/";
  } catch {
    return "/";
  }
}
