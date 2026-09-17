import { HttpResponse, http } from "msw";
import { env } from "@/env";

/** A `/me` handler returning an authenticated user; toggle `is_admin`, `email_verified` or
 *  `entitled` per test. Verified by default: an unconfirmed address is the exceptional state,
 *  and defaulting it the other way would put the verification banner on every authed test.
 *  `entitled` defaults the other way, to false — a closed-by-default grant (D-37) is the
 *  normal state of an account, so a test that wants access has to say so. */
export function meHandler(
  opts: {
    is_admin?: boolean;
    id?: string;
    email?: string;
    email_verified?: boolean;
    entitled?: boolean;
  } = {},
) {
  return http.get(`${env.apiBaseUrl}/me`, () =>
    HttpResponse.json({
      id: opts.id ?? "u1",
      email: opts.email ?? "a@b.com",
      display_name: "Test User",
      is_admin: opts.is_admin ?? false,
      email_verified: opts.email_verified ?? true,
      entitled: opts.entitled ?? false,
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
