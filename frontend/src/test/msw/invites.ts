import { HttpResponse, http } from "msw";
import { env } from "@/env";
import type { Invite } from "@/api/types";

const base = env.apiBaseUrl;

/** One outstanding, unhinted invite. Override anything a test cares about. */
export function makeInvite(overrides: Partial<Invite> = {}): Invite {
  return {
    code: "code-1",
    email_hint: null,
    created_at: "2026-09-19T10:00:00Z",
    consumed_at: null,
    consumed_by_user_id: null,
    consumed_by_email: null,
    ...overrides,
  };
}

/** A `GET /admin/invites` handler answering a fixed list, newest first as the backend does. */
export function invitesHandler(items: Invite[]) {
  return http.get(`${base}/admin/invites`, () => HttpResponse.json(items));
}
