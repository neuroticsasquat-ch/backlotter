import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchVapidPublicKey,
  isPushUnavailableError,
  subscribePush,
  toPushPayload,
  unsubscribePush,
} from "@/api/push";
import { env } from "@/env";
import { detectPushSupport, urlBase64ToUint8Array, type PushSupport } from "@/lib/push-support";

/** Where the panel is in its lifecycle. `checking` is the first client render — nothing about
 *  this browser is knowable during SSR, so the panel must not guess. */
export type PushPhase = "checking" | "ready" | "working";

export interface PushToggleState {
  phase: PushPhase;
  support: PushSupport | null;
  /** `Notification.permission`, or null before the first client render. `denied` is a dead end
   *  the page cannot undo: only the user can, in browser settings. */
  permission: NotificationPermission | null;
  subscribed: boolean;
  error: string | null;
  enable: () => void;
  disable: () => void;
}

const SW_PATH = "/sw.js";

const MESSAGES = {
  denied:
    "Notifications are blocked for this site. Turn them back on in your browser settings, then try again.",
  unavailable: "Push notifications are not switched on for this deployment yet.",
  failed: "We could not turn notifications on. Please try again.",
  failedOff: "We could not turn notifications off. Please try again.",
};

/**
 * Register the push worker, configured for this deployment.
 *
 * The API origin rides in the script URL because the browser persists a registration's URL:
 * `pushsubscriptionchange` fires with no page open, and the query string is the only
 * configuration still there when it does (see `public/sw.js`). The VAPID key deliberately
 * does *not* ride along — a URL written months ago would carry a key the deployment may have
 * rotated away from, so the worker fetches the live one when it needs it.
 */
async function registerWorker(): Promise<ServiceWorkerRegistration> {
  const url = `${SW_PATH}?api=${encodeURIComponent(env.apiBaseUrl)}`;
  await navigator.serviceWorker.register(url, { scope: "/" });
  // `ready` rather than the registration `register()` resolves with: subscribing needs an
  // *active* worker, and a first registration is still installing when that promise settles.
  return navigator.serviceWorker.ready;
}

/**
 * The browser half of the push toggle (D-36, NEU-1388).
 *
 * The state is this browser's, not the account's, which is why none of it is in TanStack
 * Query: the same user on a laptop and a phone is two independent answers, and there is no
 * server read that would tell one from the other. What the server is told is the endpoint,
 * and `POST /me/push` is idempotent by endpoint so it can be told again freely.
 */
export function usePushToggle(): PushToggleState {
  const [phase, setPhase] = useState<PushPhase>("checking");
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Nothing may be written after the panel goes away: a disabled toggle unmounts while its
  // subscribe is still in flight.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * What this browser can do, and whether it is already subscribed — read on mount, because
   * none of it exists during the server render.
   *
   * A subscription that is found is **re-posted**. Not every browser fires
   * `pushsubscriptionchange` — Safari is the notable one — and a worker that did fire it may
   * have been refused while nobody was watching, so this is the second chance at registering
   * an endpoint the backend has lost. `POST /me/push` is idempotent by endpoint and the
   * backend explicitly blesses a client that posts on every load, so the ordinary case costs
   * one 204.
   */
  useEffect(() => {
    let cancelled = false;

    async function read() {
      const detected = detectPushSupport(window);
      if (cancelled) return;
      setSupport(detected);
      setPermission(detected === "supported" ? Notification.permission : null);

      if (detected !== "supported") {
        setPhase("ready");
        return;
      }

      const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
      const existing = await registration?.pushManager.getSubscription();
      if (cancelled) return;
      setSubscribed(Boolean(existing));
      setPhase("ready");

      if (existing) {
        // Best effort and deliberately silent: the user asked for nothing here, and a toast
        // about a background repair they did not request would be noise.
        await subscribePush(toPushPayload(existing)).catch(() => undefined);
      }
    }

    void read().catch(() => {
      if (!cancelled) setPhase("ready");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Turn notifications on.
   *
   * **`Notification.requestPermission()` is called first and synchronously**, before anything
   * is awaited: iOS requires the prompt to come out of the user's own gesture, and an `await`
   * ahead of it breaks that chain and gets the call rejected. Everything that can be deferred
   * — fetching the key, registering the worker — happens after the answer is in.
   */
  const enable = useCallback(() => {
    setError(null);
    setPhase("working");
    const asked = Notification.requestPermission();

    void (async () => {
      try {
        const result = await asked;
        if (!alive.current) return;
        setPermission(result);
        if (result !== "granted") {
          setError(result === "denied" ? MESSAGES.denied : null);
          setPhase("ready");
          return;
        }

        const vapidKey = await fetchVapidPublicKey();
        const registration = await registerWorker();
        // An existing subscription is reused rather than replaced: re-subscribing would mint
        // a new endpoint and leave the old row for the backend to prune.
        const subscription =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidKey),
          }));
        await subscribePush(toPushPayload(subscription));
        if (!alive.current) return;
        setSubscribed(true);
        setPhase("ready");
      } catch (err) {
        if (!alive.current) return;
        setError(isPushUnavailableError(err) ? MESSAGES.unavailable : MESSAGES.failed);
        setPhase("ready");
      }
    })();
  }, []);

  /**
   * Turn them off.
   *
   * The server is told **before** the browser subscription is torn down. That order is what
   * makes a half-failure land on the safe side: if the local teardown then fails, the backend
   * has already stopped sending, whereas the other order would leave a live row being pushed
   * to a subscription the user believes is gone.
   */
  const disable = useCallback(() => {
    setError(null);
    setPhase("working");

    void (async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
        const existing = await registration?.pushManager.getSubscription();
        if (existing) {
          await unsubscribePush(existing.endpoint);
          await existing.unsubscribe();
        }
        if (!alive.current) return;
        setSubscribed(false);
        setPhase("ready");
      } catch {
        if (!alive.current) return;
        setError(MESSAGES.failedOff);
        setPhase("ready");
      }
    })();
  }, []);

  return { phase, support, permission, subscribed, error, enable, disable };
}
