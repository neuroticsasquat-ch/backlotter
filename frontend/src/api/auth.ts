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

// --- Account changes from the settings page (NEU-1382) ---

/** Set a new password against the current one. The backend rotates the session as it does
 *  so and answers with the account plus a fresh CSRF token; the caller has to install that
 *  token (`setCsrfToken`) or every later mutation from this tab fails its CSRF check. 401
 *  `invalid_credentials` for a wrong current password. */
export const changePassword = (body: { current_password: string; new_password: string }) =>
  apiFetch<AuthedUser>("/auth/password", { method: "POST", body: JSON.stringify(body) });

/** Ask to move the account to a new address (NEU-1341). 202 with no body: nothing has
 *  changed yet — the new address gets a confirmation link, and the account moves when that
 *  link is opened at `/email-change`. Unlike the anonymous request routes this one does say
 *  why it refused: 401 `invalid_credentials` for the password, 409 `email_in_use` for an
 *  address someone already holds. */
export const requestEmailChange = (body: { new_email: string; current_password: string }) =>
  apiFetch<void>("/auth/email-change/request", { method: "POST", body: JSON.stringify(body) });

/** Spend the token from the confirmation mail. 204; 400 `invalid_token` for a spent or
 *  expired link, 409 `email_in_use` if the address was taken between the mail going out and
 *  the link being opened. No session needed — the token is the credential. */
export const confirmEmailChange = (body: { token: string }) =>
  apiFetch<void>("/auth/email-change/confirm", { method: "POST", body: JSON.stringify(body) });
