import { describe, expect, it } from "vitest";
import { detectPushSupport, isIosLike, isStandalone, urlBase64ToUint8Array } from "./push-support";

/**
 * A stand-in `window` carrying only what the detection reads. Built rather than stubbed onto
 * the real jsdom globals so each case is independent and none of them leak: the interesting
 * states (an iPhone, an installed app, a browser with `PushManager`) are exactly the ones
 * jsdom cannot be talked into producing.
 */
function fakeWindow(opts: {
  userAgent?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
  displayMode?: string;
  serviceWorker?: boolean;
  pushManager?: boolean;
  notification?: boolean;
}): Window {
  const navigator = {
    userAgent: opts.userAgent ?? "Mozilla/5.0 (X11; Linux x86_64) Chrome/131.0",
    maxTouchPoints: opts.maxTouchPoints ?? 0,
    ...(opts.standalone === undefined ? {} : { standalone: opts.standalone }),
    ...(opts.serviceWorker ? { serviceWorker: {} } : {}),
  };
  const win: Record<string, unknown> = {
    navigator,
    matchMedia: (query: string) => ({ matches: query.includes(opts.displayMode ?? "browser") }),
  };
  if (opts.pushManager) win.PushManager = function PushManager() {};
  if (opts.notification) win.Notification = function Notification() {};
  return win as unknown as Window;
}

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15";
const IPADOS = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0";

describe("isIosLike", () => {
  it("recognises an iPhone by its user agent", () => {
    expect(isIosLike(fakeWindow({ userAgent: IPHONE }).navigator)).toBe(true);
  });

  // iPadOS 13+ claims to be a Mac; the touch points are the only thing that separates them.
  it("recognises an iPad that is pretending to be a Mac", () => {
    expect(isIosLike(fakeWindow({ userAgent: IPADOS, maxTouchPoints: 5 }).navigator)).toBe(true);
  });

  it("does not mistake a real Mac for one", () => {
    expect(isIosLike(fakeWindow({ userAgent: MAC, maxTouchPoints: 0 }).navigator)).toBe(false);
  });

  // Every engine on iOS is WebKit under the hood, so the restriction follows the OS.
  it("treats Chrome on an iPhone as iOS", () => {
    const ua = `${IPHONE} CriOS/131.0 Mobile/15E148 Safari/604.1`;
    expect(isIosLike(fakeWindow({ userAgent: ua }).navigator)).toBe(true);
  });
});

describe("isStandalone", () => {
  it("believes Apple's legacy flag", () => {
    expect(isStandalone(fakeWindow({ userAgent: IPHONE, standalone: true }))).toBe(true);
  });

  it("believes the standardised display-mode query", () => {
    expect(isStandalone(fakeWindow({ displayMode: "standalone" }))).toBe(true);
  });

  it("is false in an ordinary tab", () => {
    expect(isStandalone(fakeWindow({ userAgent: IPHONE, standalone: false }))).toBe(false);
  });

  it("is false rather than throwing where matchMedia is missing", () => {
    const win = fakeWindow({});
    (win as unknown as { matchMedia: undefined }).matchMedia = undefined;
    expect(isStandalone(win)).toBe(false);
  });
});

describe("detectPushSupport", () => {
  it("is supported on a browser with the three APIs", () => {
    const win = fakeWindow({ serviceWorker: true, pushManager: true, notification: true });
    expect(detectPushSupport(win)).toBe("supported");
  });

  it("asks an uninstalled iPhone to install rather than calling it unsupported", () => {
    const win = fakeWindow({ userAgent: IPHONE, standalone: false, serviceWorker: true });
    expect(detectPushSupport(win)).toBe("needs-install");
  });

  /**
   * The ordering guard. An uninstalled iPhone that advertised the APIs would still be unable
   * to subscribe, so it has to reach the install steps and not a toggle that fails silently.
   */
  it("still asks an uninstalled iPhone to install when the APIs look present", () => {
    const win = fakeWindow({
      userAgent: IPHONE,
      standalone: false,
      serviceWorker: true,
      pushManager: true,
      notification: true,
    });
    expect(detectPushSupport(win)).toBe("needs-install");
  });

  it("is supported on an installed iPhone that exposes the APIs", () => {
    const win = fakeWindow({
      userAgent: IPHONE,
      standalone: true,
      serviceWorker: true,
      pushManager: true,
      notification: true,
    });
    expect(detectPushSupport(win)).toBe("supported");
  });

  // Installed, but an iOS older than 16.4: no amount of installing brings the APIs back.
  it("is unsupported on an installed iPhone with no push APIs", () => {
    const win = fakeWindow({ userAgent: IPHONE, standalone: true, serviceWorker: true });
    expect(detectPushSupport(win)).toBe("unsupported");
  });

  it("is unsupported where the APIs are simply absent", () => {
    expect(detectPushSupport(fakeWindow({ serviceWorker: true }))).toBe("unsupported");
  });
});

describe("urlBase64ToUint8Array", () => {
  it("decodes an unpadded base64url key to its bytes", () => {
    // "hello" is "aGVsbG8=" in standard base64; the server sends it without the padding.
    expect(Array.from(urlBase64ToUint8Array("aGVsbG8"))).toEqual([104, 101, 108, 108, 111]);
  });

  it("maps the base64url alphabet back to the standard one", () => {
    // 0xFB 0xFF decodes from "+/8" in standard base64 and "-_8" in base64url.
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual(
      Array.from(urlBase64ToUint8Array("+/8")),
    );
  });

  it("produces the 65 bytes a real VAPID public key decodes to", () => {
    const key =
      "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUAM-Ijv1nQ2ZcVsmjk";
    expect(urlBase64ToUint8Array(key)).toHaveLength(65);
  });
});
