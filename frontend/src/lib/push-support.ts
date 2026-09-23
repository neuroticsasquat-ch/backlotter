/**
 * What this browser can do about Web Push, and the key conversion the subscribe call needs
 * (D-36, NEU-1388).
 *
 * Pure functions over an injected `window`, so the three states below can be exercised
 * without a browser: jsdom has no `PushManager` and no `navigator.standalone`, and the
 * interesting cases are precisely the ones jsdom cannot produce on its own.
 */

/**
 * The three answers, kept distinct on purpose.
 *
 * `needs-install` is **not** a flavour of `unsupported`: it is an install funnel with steps
 * the user can actually follow, the same way the timeline keeps "no follows yet" apart from
 * "no access yet". Collapsing the two would tell an iPhone user their phone cannot do this,
 * when in fact it can as soon as the app is on the Home Screen.
 */
export type PushSupport = "supported" | "needs-install" | "unsupported";

/**
 * iOS or iPadOS, whatever the browser calls itself.
 *
 * Every engine on iOS is WebKit, so the rule is about the OS and not the browser: Chrome on
 * an iPhone is under the same install restriction Safari is. iPadOS 13+ reports itself as
 * `Macintosh`, which is why the touch-point count is part of the test — a real Mac reports
 * `maxTouchPoints: 0`.
 */
export function isIosLike(nav: Navigator): boolean {
  const ua = nav.userAgent ?? "";
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && nav.maxTouchPoints > 1;
}

/**
 * Whether the page is running as an installed app rather than in a browser tab.
 *
 * Both spellings are checked because neither covers the field on its own:
 * `navigator.standalone` is Apple's non-standard flag and the only one older iOS sets, while
 * `display-mode: standalone` is the standardised query that Android and desktop answer. A
 * browser missing `matchMedia` (or a test environment that has not stubbed it) must read as
 * "not installed" rather than throw.
 */
export function isStandalone(win: Window): boolean {
  const legacy = (win.navigator as Navigator & { standalone?: boolean }).standalone;
  if (legacy === true) return true;
  try {
    return win.matchMedia?.("(display-mode: standalone)").matches === true;
  } catch {
    return false;
  }
}

/**
 * Which of the three states this browser is in.
 *
 * **The iOS check comes first, and the order is load-bearing.** On iOS the push APIs are
 * exposed only to an installed web app, so an uninstalled iPhone must be sent to the install
 * steps even if some future Safari starts advertising `PushManager` in a tab — subscribing
 * from there cannot work, and "supported" would render a toggle that silently fails. Off
 * iOS the ordinary capability test decides, and anything that fails it is genuinely
 * unsupported with nothing the user can do about it.
 */
export function detectPushSupport(win: Window): PushSupport {
  if (isIosLike(win.navigator) && !isStandalone(win)) return "needs-install";
  const capable = "serviceWorker" in win.navigator && "PushManager" in win && "Notification" in win;
  return capable ? "supported" : "unsupported";
}

/**
 * The VAPID public key as `pushManager.subscribe` wants it.
 *
 * The server serves it base64url (no padding, `-`/`_` for `+`/`/`), which is what the Web
 * Push spec puts on the wire; `applicationServerKey` takes raw bytes. The conversion is
 * standard boilerplate and is here rather than inline so a malformed key fails in one place
 * with a test on it.
 */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  // Backed by an explicit `ArrayBuffer` rather than the default `ArrayBufferLike`, which
  // could be a `SharedArrayBuffer` and is not assignable to `BufferSource` — the type
  // `pushManager.subscribe`'s `applicationServerKey` takes.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
