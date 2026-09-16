import { HttpResponse, http } from "msw";
import { env } from "@/env";

const base = env.apiBaseUrl;

export const handlers = [
  // Default: unauthenticated — individual tests can override with server.use(...)
  http.get(`${base}/me`, () => HttpResponse.json({ detail: "auth_required" }, { status: 401 })),

  // Verification and password reset (NEU-1342). The happy path is the default because the
  // interesting cases — an expired token, a transport failure — are per-test overrides; all
  // four routes answer with an empty body, 202 for a request and 204 for a spent token.
  http.post(`${base}/auth/verify/request`, () => new HttpResponse(null, { status: 202 })),
  http.post(`${base}/auth/verify`, () => new HttpResponse(null, { status: 204 })),
  http.post(`${base}/auth/reset/request`, () => new HttpResponse(null, { status: 202 })),
  http.post(`${base}/auth/reset`, () => new HttpResponse(null, { status: 204 })),
];

/** The 400 both consume routes answer with for a token that is unknown, spent, or expired. */
export const invalidTokenResponse = () =>
  HttpResponse.json({ detail: "invalid_token" }, { status: 400 });
