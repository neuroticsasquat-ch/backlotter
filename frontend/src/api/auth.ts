import { apiFetch } from "./client";
import type { AuthedUser } from "./types";

export const fetchMe = () => apiFetch<AuthedUser>("/me");

// Since NEU-1343 the door is held by Turnstile, not by an invite: `turnstile_token` is
// required and `invite_code` is the optional admin comp path. Supplied, a code is still
// validated and consumed -- a bad one fails the signup rather than being ignored -- so the
// field is omitted entirely rather than sent empty when the user didn't enter one.
export const signup = (body: {
  email: string;
  password: string;
  display_name: string;
  turnstile_token: string;
  invite_code?: string;
}) => apiFetch<AuthedUser>("/auth/signup", { method: "POST", body: JSON.stringify(body) });

export const login = (body: { email: string; password: string }) =>
  apiFetch<AuthedUser>("/auth/login", { method: "POST", body: JSON.stringify(body) });

export const logout = () => apiFetch<void>("/auth/logout", { method: "POST" });

// --- Email verification and password reset (NEU-1342) ---
//
// All four answer with an empty body — 202 for the two "request" routes, 204 for the two
// that spend a token — so they are typed `void`. The request routes answer 202 whether or
// not the address has an account: the caller is anonymous, and a response that varied would
// turn either route into an address oracle. Neither consume route opens a session, so a
// signed-in caller re-reads `/me` (via `refresh()`) rather than reading a user back here.

export const requestVerification = (body: { email: string }) =>
  apiFetch<void>("/auth/verify/request", { method: "POST", body: JSON.stringify(body) });

export const verifyEmail = (body: { token: string }) =>
  apiFetch<void>("/auth/verify", { method: "POST", body: JSON.stringify(body) });

export const requestPasswordReset = (body: { email: string }) =>
  apiFetch<void>("/auth/reset/request", { method: "POST", body: JSON.stringify(body) });

export const resetPassword = (body: { token: string; new_password: string }) =>
  apiFetch<void>("/auth/reset", { method: "POST", body: JSON.stringify(body) });
