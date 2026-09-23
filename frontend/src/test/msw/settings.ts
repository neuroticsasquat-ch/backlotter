import { HttpResponse, http } from "msw";
import { env } from "@/env";
import type { AlertStore, DigestCadence, UserSettings } from "@/api/types";

const base = env.apiBaseUrl;

export function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    digest_cadence: "weekly",
    alert_stores: ["stream"],
    ical_token: "tok-abcdef0123456789",
    created_at: "2026-09-18T00:00:00Z",
    updated_at: "2026-09-18T00:00:00Z",
    ...overrides,
  };
}

/** A PATCH of the settings row: either field, or both, as the backend's request model takes
 *  them — the screen writes the control the user touched, not the whole row. */
type SettingsPatch = { digest_cadence?: DigestCadence; alert_stores?: AlertStore[] };

/**
 * `/me/settings` with a row that remembers what was PATCHed into it, so a test can assert a
 * setting persisted the way "done when" asks — by reading it back — rather than only that a
 * request went out. `patches` is the bodies in the order they arrived.
 */
export function settingsHandlers(initial: Partial<UserSettings> = {}) {
  let row = makeSettings(initial);
  const patches: SettingsPatch[] = [];
  let rotations = 0;

  const handlers = [
    http.get(`${base}/me/settings`, () => HttpResponse.json(row)),
    http.patch(`${base}/me/settings`, async ({ request }) => {
      const body = (await request.json()) as SettingsPatch;
      patches.push(body);
      // Only what the body names, so a store change does not reset the cadence — which is the
      // property the one-field PATCH exists for.
      row = {
        ...row,
        ...(body.digest_cadence !== undefined ? { digest_cadence: body.digest_cadence } : {}),
        ...(body.alert_stores !== undefined ? { alert_stores: body.alert_stores } : {}),
        updated_at: new Date().toISOString(),
      };
      return HttpResponse.json(row);
    }),
    // The rotate answers with the whole row, as the backend's does, and the new token is one
    // the caller could not have guessed — which is the property the panel's redraw rests on.
    http.post(`${base}/me/settings/ical-token/rotate`, () => {
      rotations += 1;
      row = {
        ...row,
        ical_token: `tok-rotated-${rotations}`,
        updated_at: new Date().toISOString(),
      };
      return HttpResponse.json(row);
    }),
  ];

  return { handlers, patches, rotations: () => rotations, current: () => row };
}
