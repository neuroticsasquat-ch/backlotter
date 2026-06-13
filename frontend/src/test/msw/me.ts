import { HttpResponse, http } from "msw";
import { env } from "@/env";

/** A `/me` handler returning an authenticated user; toggle `is_admin` per test. */
export function meHandler(opts: { is_admin?: boolean; id?: string } = {}) {
  return http.get(`${env.apiBaseUrl}/me`, () =>
    HttpResponse.json({
      id: opts.id ?? "u1",
      email: "a@b.com",
      display_name: "Test User",
      is_admin: opts.is_admin ?? false,
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
