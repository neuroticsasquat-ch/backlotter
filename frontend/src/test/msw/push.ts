import { HttpResponse, http } from "msw";
import { env } from "@/env";
import type { PushSubscriptionPayload } from "@/api/types";

const base = env.apiBaseUrl;

export const VAPID_PUBLIC_KEY =
  "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUAM-Ijv1nQ2ZcVsmjk";

/**
 * `/me/push` with a registry that remembers which endpoints it holds, so a test can assert
 * the toggle's effect the way "done when" asks — by reading the registration back — rather
 * than only that a request went out.
 *
 * `subscribes` is every body that arrived in order, which is what makes the idempotent
 * re-post on mount visible to a test; `endpoints()` is the set that survives the
 * unsubscribes.
 */
export function pushHandlers(opts: { configured?: boolean } = {}) {
  const configured = opts.configured ?? true;
  const subscribes: PushSubscriptionPayload[] = [];
  const unsubscribes: string[] = [];
  const registry = new Set<string>();

  // What the backend answers on a deployment holding no usable VAPID keypair. `DELETE` sits
  // outside that guard there, so it is not guarded here either: a user must be able to
  // unregister a browser from a deployment whose keys were pulled.
  const unavailable = () => HttpResponse.json({ detail: "push_unavailable" }, { status: 503 });

  const handlers = [
    http.get(`${base}/me/push/vapid-public-key`, () =>
      configured ? HttpResponse.json({ public_key: VAPID_PUBLIC_KEY }) : unavailable(),
    ),
    http.post(`${base}/me/push`, async ({ request }) => {
      if (!configured) return unavailable();
      const body = (await request.json()) as PushSubscriptionPayload;
      subscribes.push(body);
      registry.add(body.endpoint);
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete(`${base}/me/push`, async ({ request }) => {
      const body = (await request.json()) as { endpoint: string };
      unsubscribes.push(body.endpoint);
      registry.delete(body.endpoint);
      return new HttpResponse(null, { status: 204 });
    }),
  ];

  return { handlers, subscribes, unsubscribes, endpoints: () => [...registry] };
}
