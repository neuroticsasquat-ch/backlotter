import { vi } from "vitest";

/**
 * The browser push APIs, faked onto `window` and `navigator` for a test.
 *
 * jsdom implements none of them — no `PushManager`, no `Notification`, no
 * `navigator.serviceWorker` — which is exactly why they are worth faking rather than
 * skipping: the states the panel has to get right (an uninstalled iPhone, a refused
 * permission, a browser with nothing at all) cannot otherwise be reached from a test.
 *
 * Every installed property is deleted again by the returned `restore`, so a file can set up a
 * different browser per test without leaking into the next one.
 */

export interface FakePushSubscription {
  endpoint: string;
  unsubscribe: ReturnType<typeof vi.fn>;
  toJSON: () => { endpoint: string; expirationTime: null; keys: { p256dh: string; auth: string } };
}

export function fakeSubscription(endpoint: string): FakePushSubscription {
  return {
    endpoint,
    unsubscribe: vi.fn(() => Promise.resolve(true)),
    toJSON: () => ({
      endpoint,
      expirationTime: null,
      keys: { p256dh: `p256dh-${endpoint}`, auth: `auth-${endpoint}` },
    }),
  };
}

export interface PushEnvOptions {
  /** What `Notification.permission` reads, and what the prompt resolves to. When
   *  `promptResult` is omitted the prompt grants. */
  permission?: NotificationPermission;
  promptResult?: NotificationPermission;
  /** A subscription this browser already holds, as a returning user would have. */
  existing?: FakePushSubscription | null;
  /** The subscription `pushManager.subscribe` mints, or a rejection. */
  subscribeResult?: FakePushSubscription | Error;
  /** Pretend to be an iPhone, and say whether it is installed to the Home Screen. */
  ios?: boolean;
  standalone?: boolean;
  /** Leave the push APIs off entirely — a browser that genuinely cannot do this. */
  unsupported?: boolean;
}

export interface PushEnv {
  requestPermission: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  getSubscription: ReturnType<typeof vi.fn>;
  /** Whatever the browser currently holds, following subscribe/unsubscribe. */
  current: () => FakePushSubscription | null;
  restore: () => void;
}

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15";

function define(target: object, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, configurable: true, writable: true });
}

export function installPushEnv(opts: PushEnvOptions = {}): PushEnv {
  const installed: [object, string][] = [];
  const set = (target: object, key: string, value: unknown) => {
    define(target, key, value);
    installed.push([target, key]);
  };

  let held: FakePushSubscription | null = opts.existing ?? null;

  if (opts.ios) {
    set(navigator, "userAgent", IPHONE_UA);
    set(navigator, "maxTouchPoints", 5);
    set(navigator, "standalone", opts.standalone ?? false);
  }
  // jsdom's matchMedia is missing outright; the panel reads it through `isStandalone`.
  set(window, "matchMedia", (query: string) => ({
    matches: Boolean(opts.standalone) && query.includes("standalone"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));

  const requestPermission = vi.fn(() =>
    Promise.resolve(opts.promptResult ?? opts.permission ?? "granted"),
  );
  const subscribe = vi.fn(() => {
    const result = opts.subscribeResult ?? fakeSubscription("https://push.example/new");
    if (result instanceof Error) return Promise.reject(result);
    held = result;
    return Promise.resolve(result);
  });
  const getSubscription = vi.fn(() => Promise.resolve(held));

  if (!opts.unsupported) {
    const pushManager = { subscribe, getSubscription };
    const registration = { pushManager, scope: "https://app.test/" };
    const register = vi.fn(() => Promise.resolve(registration));

    set(window, "PushManager", function PushManager() {});
    set(window, "Notification", {
      permission: opts.permission ?? "default",
      requestPermission,
    });
    set(navigator, "serviceWorker", {
      register,
      ready: Promise.resolve(registration),
      getRegistration: vi.fn(() => Promise.resolve(registration)),
      addEventListener: () => {},
    });

    return {
      requestPermission,
      register,
      subscribe,
      getSubscription,
      current: () => held,
      restore: () => installed.forEach(([target, key]) => delete (target as never)[key]),
    };
  }

  const noop = vi.fn();
  return {
    requestPermission: noop,
    register: noop,
    subscribe: noop,
    getSubscription: noop,
    current: () => null,
    restore: () => installed.forEach(([target, key]) => delete (target as never)[key]),
  };
}
