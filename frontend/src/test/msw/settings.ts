import { HttpResponse, http } from "msw";
import { env } from "@/env";
import type { DigestCadence, UserSettings } from "@/api/types";

const base = env.apiBaseUrl;

export function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    digest_cadence: "weekly",
    ical_token: "tok-abcdef0123456789",
    created_at: "2026-09-18T00:00:00Z",
    updated_at: "2026-09-18T00:00:00Z",
    ...overrides,
  };
}

/**
 * `/me/settings` with a row that remembers what was PATCHed into it, so a test can assert the
 * cadence persisted the way "done when" asks — by reading it back — rather than only that a
 * request went out. `patches` is the bodies in the order they arrived.
 */
export function settingsHandlers(initial: Partial<UserSettings> = {}) {
  let row = makeSettings(initial);
  const patches: { digest_cadence: DigestCadence }[] = [];

  const handlers = [
    http.get(`${base}/me/settings`, () => HttpResponse.json(row)),
    http.patch(`${base}/me/settings`, async ({ request }) => {
      const body = (await request.json()) as { digest_cadence: DigestCadence };
      patches.push(body);
      row = { ...row, digest_cadence: body.digest_cadence, updated_at: new Date().toISOString() };
      return HttpResponse.json(row);
    }),
  ];

  return { handlers, patches, current: () => row };
}
