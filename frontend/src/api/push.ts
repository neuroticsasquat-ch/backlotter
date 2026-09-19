/**
 * `/me/push` — registering this browser for notifications and tearing that down again
 * (D-36, NEU-1388). Subscriber-only (D-39), like `/me/settings` next door.
 *
 * No TanStack hooks here, unlike the rest of `api/`: the toggle's state does not live on the
 * server. What the panel renders is whether *this browser* currently holds a
 * `PushSubscription`, which is read from the `PushManager` and cannot be cached across
 * devices — the same account signed in on a laptop and a phone is two independent answers.
 * `components/push/usePushToggle.ts` owns that state; these are the plain fetchers it calls.
 */

import { ApiError, apiFetch } from "./client";
import type { PushSubscriptionPayload, VapidPublicKey } from "./types";

export const fetchVapidPublicKey = () =>
  apiFetch<VapidPublicKey>("/me/push/vapid-public-key").then((res) => res.public_key);

/** Register this browser, or refresh the registration it already holds. The backend answers
 *  204 and is idempotent by endpoint, which is what lets the panel re-post on every mount to
 *  heal a rotation the service worker could not report (see `public/sw.js`). */
export const subscribePush = (subscription: PushSubscriptionPayload) =>
  apiFetch<void>("/me/push", { method: "POST", body: JSON.stringify(subscription) });

/** Unregister this browser. A body rather than a query string because the endpoint is long
 *  and has no business in an access log; 204 whether or not the row was still there. */
export const unsubscribePush = (endpoint: string) =>
  apiFetch<void>("/me/push", { method: "DELETE", body: JSON.stringify({ endpoint }) });

/**
 * The 503 the two configured-only routes answer with when the deployment holds no usable
 * VAPID keypair.
 *
 * Worth telling apart from an ordinary failure because it is neither the user's fault nor
 * something they can retry into working: the panel says the feature is not switched on here
 * rather than offering a button that will fail again. `DELETE` is outside the guard on the
 * backend, so unsubscribing still works on a deployment whose keys were pulled.
 */
export function isPushUnavailableError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 503;
}

/**
 * A browser `PushSubscription` in the shape the backend models.
 *
 * `toJSON()` is the spec'd accessor for the keys — they are not readable as properties — and
 * it also carries `expirationTime`, which is dropped here rather than sent and ignored.
 *
 * A subscription missing either key throws rather than sending an empty string: the backend
 * bounds both at `min_length=1`, so the blank would come back as a 422 that reads like a
 * client bug instead of the malformed subscription it actually is.
 */
export function toPushPayload(subscription: PushSubscription): PushSubscriptionPayload {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!p256dh || !auth) throw new Error("This browser returned a push subscription with no keys.");
  return { endpoint: json.endpoint ?? subscription.endpoint, keys: { p256dh, auth } };
}
