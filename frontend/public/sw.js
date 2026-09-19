/**
 * The push service worker (D-36, NEU-1388).
 *
 * Deliberately minimal: it handles `push`, `notificationclick` and `pushsubscriptionchange`
 * and **registers no `fetch` handler**, so it never sits in front of a navigation. This app
 * is server-rendered from a Cloudflare Worker; a caching service worker in front of that
 * would be a second, stale rendering path for no benefit.
 *
 * ## How it is configured
 *
 * A static asset cannot import `env.ts`, and the API origin is a property of the deployment
 * rather than a constant. It arrives in the script URL's query string —
 * `register("/sw.js?api=…")` — because the browser **persists the registration URL**. That
 * matters for `pushsubscriptionchange`, which fires days later with no page open and no one
 * around to tell this worker anything: `self.location.search` still holds the origin it was
 * registered with.
 *
 * The VAPID key is deliberately **not** carried the same way. A registration URL written
 * months ago would still hold whatever key was current then, and re-subscribing with a key
 * the deployment has since rotated away from produces a registration it can never sign for.
 * The key is fetched at rotation time instead, so it is always the live one.
 *
 * `urlBase64ToUint8Array` below duplicates `src/lib/push-support.ts` for the same reason the
 * manifest duplicates `SITE_NAME`: this file is served as-is and can import nothing.
 * `src/lib/sw.test.ts` asserts the two agree.
 */

const CONFIG = new URL(self.location.href).searchParams;

/** The API origin, e.g. `https://api.backlotter.com`. Empty if the worker was somehow
 *  registered without it, in which case the rotation handler does nothing rather than POST
 *  to this origin and 404. */
const API_BASE = CONFIG.get("api") || "";

/** NEU-1404's contract with this ticket: both files exist in `public/icons/` and are asserted
 *  by `src/lib/manifest.test.ts`. The badge is the monochrome silhouette Android puts in the
 *  status bar; other platforms ignore it. */
const DEFAULT_ICON = "/icons/icon-192.png";
const BADGE_ICON = "/icons/badge-96.png";

const FALLBACK_TITLE = "backlotter";

// Take over as soon as a new version lands. Safe precisely because there is no `fetch`
// handler: nothing that is mid-flight through this worker can be cut off by the swap.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/**
 * A notification per pushed event.
 *
 * The payload is `push_sender.PushItem.build`'s: `{title, body, url, icon}`, flat and small
 * because push services cap the encrypted body. Untagged on purpose — two films with news on
 * the same morning are two things to read, not one that replaces the other.
 */
self.addEventListener("push", (event) => {
  event.waitUntil(showNotification(readPayload(event.data)));
});

function readPayload(data) {
  if (!data) return {};
  try {
    return data.json() || {};
  } catch {
    // Not JSON. A notification with the raw text beats swallowing the push: a `push` event
    // that shows nothing is a permission violation in Chrome and costs the subscription.
    return { body: data.text() };
  }
}

function showNotification(payload) {
  return self.registration.showNotification(payload.title || FALLBACK_TITLE, {
    body: payload.body || "",
    icon: payload.icon || DEFAULT_ICON,
    badge: BADGE_ICON,
    data: { url: payload.url || "/" },
  });
}

/** Focus a tab already on this origin and send it to the film, or open one. Reusing a tab
 *  rather than always opening a new one is what stops a week of notifications leaving a week
 *  of windows behind. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openTarget(event.notification.data && event.notification.data.url));
});

async function openTarget(rawUrl) {
  const target = new URL(rawUrl || "/", self.location.origin);
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
    if (new URL(client.url).origin !== target.origin) continue;
    if (client.url !== target.href && typeof client.navigate === "function") {
      const navigated = await client.navigate(target.href);
      // `navigate()` resolves with the client it moved, or null if the browser refused.
      await (navigated || client).focus();
    } else {
      await client.focus();
    }
    return;
  }
  await self.clients.openWindow(target.href);
}

/**
 * Re-register when the browser rotates the endpoint.
 *
 * Without this, delivery stops while the toggle still reads "on": the push service starts
 * answering 404/410, NEU-1387's pruning drops the stale row, and nothing ever registers the
 * live one — the user is unsubscribed without being told.
 *
 * Some browsers hand us the replacement on the event; the rest expect us to subscribe again
 * ourselves, which is what the VAPID key in the registration URL is for. The old endpoint is
 * left for the backend's own 404/410 pruning to collect rather than deleted here, because a
 * `DELETE` that failed would leave the *new* row unposted for the sake of tidying the dead
 * one.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(resubscribe(event));
});

async function resubscribe(event) {
  if (!API_BASE) return;

  // The session first, because it is also where the CSRF token comes from and because a
  // signed-out or lapsed account has nothing to re-register. A failure here is the end of it.
  const csrf = await readCsrfToken();
  if (!csrf) return;

  let fresh = event.newSubscription;
  if (!fresh) {
    const key = await fetchVapidKey();
    if (!key) return;
    fresh = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
  }
  if (!fresh) return;
  await postSubscription(fresh, csrf);
}

/**
 * The CSRF token, taken from `GET /me` exactly as the app takes it.
 *
 * **Not read from the cookie.** The `csrf_token` cookie is set by the API origin with no
 * `Domain` (`COOKIE_DOMAIN` is unset), so it is host-only on `api.…` and invisible to this
 * worker, which lives on the site origin and can only see its own jar. `cookieStore` would
 * find nothing in production on every browser, not merely the ones that lack it — which is
 * why `AuthContext` reads `user.csrf_token` off the response body rather than the cookie.
 * Returns null for a signed-out or unreachable session, which is also the signal to stop.
 */
async function readCsrfToken() {
  try {
    const res = await fetch(`${API_BASE}/me`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user && user.csrf_token ? user.csrf_token : null;
  } catch {
    return null;
  }
}

/** The key this deployment currently signs with. 503 when it holds none and 403 for a lapsed
 *  grant — both mean there is nothing to re-register, so both come back null. */
async function fetchVapidKey() {
  try {
    const res = await fetch(`${API_BASE}/me/push/vapid-public-key`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body && body.public_key ? body.public_key : null;
  } catch {
    return null;
  }
}

/**
 * Register the replacement.
 *
 * The response is checked rather than dropped on the floor: this is the one write that
 * happens with nobody watching, so a refusal that goes unnoticed here is precisely the silent
 * unsubscribe the handler exists to prevent. There is no retry to attempt from a worker that
 * is about to be torn down — the settings panel's re-post on mount is the second chance —
 * but a rejected write must at least be visible in the console rather than look like success.
 */
async function postSubscription(subscription, csrf) {
  const json = typeof subscription.toJSON === "function" ? subscription.toJSON() : subscription;
  const keys = json.keys || {};
  if (!keys.p256dh || !keys.auth) return;
  const res = await fetch(`${API_BASE}/me/push`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: JSON.stringify({
      endpoint: json.endpoint || subscription.endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
    }),
  });
  if (!res.ok) {
    console.error(`[sw] re-registering the rotated push subscription failed: ${res.status}`);
  }
}

/** Mirror of `urlBase64ToUint8Array` in `src/lib/push-support.ts`; see the module comment. */
function urlBase64ToUint8Array(base64Url) {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
