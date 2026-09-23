import { readFileSync } from "node:fs";
import { join } from "node:path";
// Aliased for the same reason `manifest.test.ts` aliases it: Vite rewrites the literal
// `new URL(..., import.meta.url)` pattern into an asset reference, and under a different
// name the transform does not match so the file URL survives.
import { fileURLToPath, URL as NodeURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { HttpResponse, http } from "msw";
import { env } from "@/env";
import { server } from "@/test/msw/server";
import { urlBase64ToUint8Array } from "./push-support";

const PUBLIC_DIR = fileURLToPath(new NodeURL("../../public/", import.meta.url));
const SOURCE = readFileSync(join(PUBLIC_DIR, "sw.js"), "utf8");

const VAPID_KEY =
  "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUAM-Ijv1nQ2ZcVsmjk";
const ORIGIN = "https://app.test";

interface FakeClient {
  url: string;
  focus: ReturnType<typeof vi.fn>;
  navigate?: ReturnType<typeof vi.fn>;
}

function fakeClient(url: string, withNavigate = true): FakeClient {
  const client: FakeClient = { url, focus: vi.fn(() => Promise.resolve()) };
  if (withNavigate) client.navigate = vi.fn(() => Promise.resolve(null));
  return client;
}

/** A `PushSubscription` as the browser hands one over: the keys are reachable only through
 *  `toJSON()`, and it carries the `expirationTime` the backend refuses to model. */
function fakeSubscription(endpoint: string, p256dh = "key-p", auth = "key-a") {
  return {
    endpoint,
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh, auth } }),
  };
}

/**
 * Load `public/sw.js` and drive it.
 *
 * The worker is a static asset, not a module — it cannot be imported — so it is evaluated
 * here with a stand-in `self` shadowing the real global, exactly as a `ServiceWorkerGlobalScope`
 * would provide it. That is what lets a `pushsubscriptionchange` be dispatched at it in a
 * test, which is the event that is otherwise impossible to observe until it fails in
 * production weeks later.
 */
function loadWorker(
  opts: {
    search?: string;
    windows?: FakeClient[];
    subscribe?: (options: unknown) => Promise<unknown>;
  } = {},
) {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const notifications: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const subscribeCalls: unknown[] = [];

  const search = opts.search ?? `?api=${encodeURIComponent(env.apiBaseUrl)}`;
  const scope: Record<string, unknown> = {
    location: new NodeURL(`${ORIGIN}/sw.js${search}`),
    addEventListener: (type: string, fn: (event: Record<string, unknown>) => void) =>
      listeners.set(type, fn),
    skipWaiting: vi.fn(),
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        notifications.push({ title, options });
        return Promise.resolve();
      },
      pushManager: {
        subscribe: (options: unknown) => {
          subscribeCalls.push(options);
          return opts.subscribe
            ? opts.subscribe(options)
            : Promise.resolve(fakeSubscription("https://push.example/rotated"));
        },
      },
    },
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve(opts.windows ?? []),
      openWindow: (url: string) => {
        opened.push(url);
        return Promise.resolve(null);
      },
    },
  };
  new Function("self", SOURCE)(scope);

  async function dispatch(type: string, event: Record<string, unknown> = {}) {
    const listener = listeners.get(type);
    if (!listener) throw new Error(`the worker registered no "${type}" listener`);
    const pending: Promise<unknown>[] = [];
    listener({ ...event, waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
    await Promise.all(pending);
  }

  return { dispatch, notifications, opened, subscribeCalls, listeners };
}

/** A `push` event's data, in the two shapes the browser can hand one over in. */
const jsonData = (payload: unknown) => ({
  json: () => payload,
  text: () => JSON.stringify(payload),
});
const textData = (text: string) => ({
  json: () => {
    throw new SyntaxError("not JSON");
  },
  text: () => text,
});

/**
 * The three routes the rotation handler touches, and a record of what it sent.
 *
 * `GET /me` is in here because that is where the worker gets its CSRF token — the cookie is
 * host-only on the API origin and a worker on the site origin cannot see it, which is the
 * same reason `AuthContext` reads the token off the body.
 */
function captureRotation(opts: { signedIn?: boolean; key?: string | null } = {}) {
  const posts: { body: unknown; csrf: string | null }[] = [];
  const meCalls: string[] = [];
  const signedIn = opts.signedIn ?? true;
  const key = opts.key === undefined ? VAPID_KEY : opts.key;

  server.use(
    http.get(`${env.apiBaseUrl}/me`, () => {
      meCalls.push("me");
      return signedIn
        ? HttpResponse.json({ id: "u1", csrf_token: "csrf-from-me", entitled: true })
        : HttpResponse.json({ detail: "auth_required" }, { status: 401 });
    }),
    http.get(`${env.apiBaseUrl}/me/push/vapid-public-key`, () =>
      key
        ? HttpResponse.json({ public_key: key })
        : HttpResponse.json({ detail: "push_unavailable" }, { status: 503 }),
    ),
    http.post(`${env.apiBaseUrl}/me/push`, async ({ request }) => {
      posts.push({ body: await request.json(), csrf: request.headers.get("X-CSRF-Token") });
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return { posts, meCalls };
}

describe("public/sw.js", () => {
  it("registers only the three push listeners and no fetch handler", () => {
    const { listeners } = loadWorker();
    expect([...listeners.keys()].sort()).toEqual([
      "activate",
      "install",
      "notificationclick",
      "push",
      "pushsubscriptionchange",
    ]);
    // A caching worker in front of an SSR app is a second, stale rendering path.
    expect(listeners.has("fetch")).toBe(false);
  });

  describe("push", () => {
    it("shows the notification the backend sent", async () => {
      const worker = loadWorker();
      await worker.dispatch("push", {
        data: jsonData({
          title: "Trailer: Dune Part Three",
          body: "The first trailer is up.",
          url: "https://app.test/film/dune-part-three",
          icon: "https://image.tmdb.org/poster.jpg",
        }),
      });

      expect(worker.notifications).toHaveLength(1);
      const [{ title, options }] = worker.notifications;
      expect(title).toBe("Trailer: Dune Part Three");
      expect(options.body).toBe("The first trailer is up.");
      expect(options.icon).toBe("https://image.tmdb.org/poster.jpg");
      expect(options.badge).toBe("/icons/badge-96.png");
      expect(options.data).toEqual({ url: "https://app.test/film/dune-part-three" });
    });

    // The backend sends `icon: null` for a film with no poster.
    it("falls back to the install icon when the payload carries none", async () => {
      const worker = loadWorker();
      await worker.dispatch("push", {
        data: jsonData({ title: "In theaters: Wicked", body: "Out today.", url: "/film/wicked" }),
      });

      expect(worker.notifications[0].options.icon).toBe("/icons/icon-192.png");
    });

    /** Showing nothing on a `push` is a permission violation in Chrome and costs the
     *  subscription, so an unparseable payload still has to put something on screen. */
    it("still notifies when the payload is not JSON", async () => {
      const worker = loadWorker();
      await worker.dispatch("push", { data: textData("something happened") });

      expect(worker.notifications[0].title).toBe("backlotter");
      expect(worker.notifications[0].options.body).toBe("something happened");
    });

    it("still notifies when there is no payload at all", async () => {
      const worker = loadWorker();
      await worker.dispatch("push", { data: null });

      expect(worker.notifications[0].title).toBe("backlotter");
      expect(worker.notifications[0].options.data).toEqual({ url: "/" });
    });
  });

  describe("notificationclick", () => {
    const clickEvent = (url: string, close = vi.fn()) => ({
      notification: { close, data: { url } },
    });

    it("reuses a tab already on this origin and sends it to the film", async () => {
      const open = fakeClient(`${ORIGIN}/feed`);
      const worker = loadWorker({ windows: [open] });
      await worker.dispatch("notificationclick", clickEvent(`${ORIGIN}/film/wicked`));

      expect(open.navigate).toHaveBeenCalledWith(`${ORIGIN}/film/wicked`);
      expect(open.focus).toHaveBeenCalled();
      expect(worker.opened).toEqual([]);
    });

    it("only focuses a tab that is already on the target", async () => {
      const open = fakeClient(`${ORIGIN}/film/wicked`);
      const worker = loadWorker({ windows: [open] });
      await worker.dispatch("notificationclick", clickEvent(`${ORIGIN}/film/wicked`));

      expect(open.navigate).not.toHaveBeenCalled();
      expect(open.focus).toHaveBeenCalled();
    });

    it("opens a window when nothing on this origin is already open", async () => {
      const worker = loadWorker({ windows: [fakeClient("https://elsewhere.test/")] });
      await worker.dispatch("notificationclick", clickEvent(`${ORIGIN}/film/wicked`));

      expect(worker.opened).toEqual([`${ORIGIN}/film/wicked`]);
    });

    it("resolves a relative url against this origin", async () => {
      const worker = loadWorker();
      await worker.dispatch("notificationclick", clickEvent("/film/wicked"));

      expect(worker.opened).toEqual([`${ORIGIN}/film/wicked`]);
    });

    it("closes the notification it was given", async () => {
      const close = vi.fn();
      const worker = loadWorker();
      await worker.dispatch("notificationclick", clickEvent("/film/wicked", close));

      expect(close).toHaveBeenCalled();
    });
  });

  describe("pushsubscriptionchange", () => {
    it("posts the replacement the browser handed it", async () => {
      const { posts } = captureRotation();
      const worker = loadWorker();
      await worker.dispatch("pushsubscriptionchange", {
        newSubscription: fakeSubscription("https://push.example/new", "p-new", "a-new"),
      });

      expect(posts).toHaveLength(1);
      expect(posts[0].body).toEqual({
        endpoint: "https://push.example/new",
        keys: { p256dh: "p-new", auth: "a-new" },
      });
      // `expirationTime` is deliberately not modelled by the backend, so it is not sent.
      expect(posts[0].body).not.toHaveProperty("expirationTime");
      expect(worker.subscribeCalls).toEqual([]);
    });

    it("subscribes again itself when the browser hands it nothing", async () => {
      const { posts } = captureRotation();
      const worker = loadWorker();
      await worker.dispatch("pushsubscriptionchange", {});

      expect(worker.subscribeCalls).toHaveLength(1);
      const options = worker.subscribeCalls[0] as {
        userVisibleOnly: boolean;
        applicationServerKey: Uint8Array;
      };
      expect(options.userVisibleOnly).toBe(true);
      // The worker's own copy of the key conversion has to agree with the app's.
      expect(Array.from(options.applicationServerKey)).toEqual(
        Array.from(urlBase64ToUint8Array(VAPID_KEY)),
      );
      expect(posts).toHaveLength(1);
      expect(posts[0].body).toMatchObject({ endpoint: "https://push.example/rotated" });
    });

    /**
     * The token comes from `GET /me`, not from a cookie. The `csrf_token` cookie is host-only
     * on the API origin, so a worker on the site origin cannot read it on *any* browser —
     * signing from `cookieStore` would have 403'd every rotation in production.
     */
    it("signs the post with the token from /me", async () => {
      const { posts, meCalls } = captureRotation();
      const worker = loadWorker();
      await worker.dispatch("pushsubscriptionchange", {
        newSubscription: fakeSubscription("https://push.example/new"),
      });

      expect(meCalls).toEqual(["me"]);
      expect(posts[0].csrf).toBe("csrf-from-me");
    });

    /** Re-subscribing with a key the deployment has rotated away from would mint a
     *  registration it can never sign for, so the live key is fetched rather than remembered. */
    it("subscribes with the key the deployment serves now", async () => {
      const rotatedKey =
        "BPYkFSGCLh1kOSyHcv1mOLZBcnkXjNlJCVcrCWQYdmWjLqXZxNPqLKjHhJmVFEkLwEtUqnRbYgCdEfGhIjKl";
      captureRotation({ key: rotatedKey });
      const worker = loadWorker();
      await worker.dispatch("pushsubscriptionchange", {});

      const options = worker.subscribeCalls[0] as { applicationServerKey: Uint8Array };
      expect(Array.from(options.applicationServerKey)).toEqual(
        Array.from(urlBase64ToUint8Array(rotatedKey)),
      );
    });

    it("gives up quietly when nobody is signed in on this browser", async () => {
      const { posts } = captureRotation({ signedIn: false });
      const worker = loadWorker();
      await worker.dispatch("pushsubscriptionchange", {
        newSubscription: fakeSubscription("https://push.example/new"),
      });

      expect(posts).toEqual([]);
      expect(worker.subscribeCalls).toEqual([]);
    });

    it("gives up when the deployment serves no key", async () => {
      const { posts } = captureRotation({ key: null });
      const worker = loadWorker();
      await worker.dispatch("pushsubscriptionchange", {});

      expect(posts).toEqual([]);
      expect(worker.subscribeCalls).toEqual([]);
    });

    it("does nothing when it was registered without its configuration", async () => {
      const { posts, meCalls } = captureRotation();
      const worker = loadWorker({ search: "" });
      await worker.dispatch("pushsubscriptionchange", {
        newSubscription: fakeSubscription("https://push.example/new"),
      });

      expect(posts).toEqual([]);
      expect(meCalls).toEqual([]);
      expect(worker.subscribeCalls).toEqual([]);
    });

    it("posts nothing when re-subscribing is refused", async () => {
      const { posts } = captureRotation();
      const worker = loadWorker({ subscribe: () => Promise.resolve(null) });
      await worker.dispatch("pushsubscriptionchange", {});

      expect(posts).toEqual([]);
    });

    it("sends no subscription that is missing its keys", async () => {
      const { posts } = captureRotation();
      const worker = loadWorker();
      await worker.dispatch("pushsubscriptionchange", {
        newSubscription: { endpoint: "https://push.example/new", toJSON: () => ({ keys: {} }) },
      });

      expect(posts).toEqual([]);
    });

    /** The one write that happens with nobody watching: a refusal that looked like success
     *  here is exactly the silent unsubscribe the handler exists to prevent. */
    it("reports a refused post rather than swallowing it", async () => {
      captureRotation();
      server.use(
        http.post(`${env.apiBaseUrl}/me/push`, () =>
          HttpResponse.json({ detail: "csrf_invalid" }, { status: 403 }),
        ),
      );
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const worker = loadWorker();
      await worker.dispatch("pushsubscriptionchange", {
        newSubscription: fakeSubscription("https://push.example/new"),
      });

      expect(logged).toHaveBeenCalledWith(expect.stringContaining("403"));
      logged.mockRestore();
    });
  });
});
