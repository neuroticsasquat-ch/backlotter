import { HttpResponse, http } from "msw";
import { env } from "@/env";

/** A `/me` handler returning an authenticated user; toggle `is_admin` or `email_verified`
 *  per test. Verified by default: an unconfirmed address is the exceptional state, and
 *  defaulting it the other way would put the verification banner on every authed test. */
export function meHandler(
  opts: { is_admin?: boolean; id?: string; email?: string; email_verified?: boolean } = {},
) {
  return http.get(`${env.apiBaseUrl}/me`, () =>
    HttpResponse.json({
      id: opts.id ?? "u1",
      email: opts.email ?? "a@b.com",
      display_name: "Test User",
      is_admin: opts.is_admin ?? false,
      email_verified: opts.email_verified ?? true,
      created_at: new Date().toISOString(),
      csrf_token: "test-csrf",
    }),
  );
}

export function unauthMeHandler() {
  return http.get(`${env.apiBaseUrl}/me`, () =>
    HttpResponse.json({ detail: "auth_required" }, { status: 401 }),
  );
}
