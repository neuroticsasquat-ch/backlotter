/**
 * A self-unregistering shim, kept permanently (ADR-0021, NEU-1470).
 *
 * This file was the Web Push service worker (D-36, NEU-1388). Push is retired — the digest is
 * the only delivery — but browsers that enabled it still hold a registration for this URL and
 * check it for updates on their next visit. They pick this version up, drop their push
 * subscription and forget the worker. Browsers that never registered fetch nothing.
 *
 * Never delete this file: a 404 on the update check leaves the old worker installed
 * indefinitely.
 */

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    self.registration.pushManager
      .getSubscription()
      .then((subscription) => subscription && subscription.unsubscribe())
      .catch(() => undefined)
      .then(() => self.registration.unregister()),
  );
});
