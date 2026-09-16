import { act } from "@testing-library/react";

/**
 * A stand-in for Cloudflare's `api.js`, which jsdom will never load.
 *
 * `<Turnstile>` talks to the documented `window.turnstile` global and skips the script tag
 * when something has already put one there, so installing this is the same seam the real
 * script uses rather than a mock of our own code — the component under test is the shipped
 * one, and the token it hands the signup form is the only thing faked.
 */

type RenderOptions = {
  sitekey: string;
  callback: (token: string) => void;
  "error-callback": () => void;
  "expired-callback": () => void;
};

export const TEST_TURNSTILE_TOKEN = "test-turnstile-token";

export type FakeTurnstile = {
  /** Solve the live challenge, as a user clicking the checkbox would. */
  solve: (token?: string) => void;
  /** Let the live token time out, as Turnstile does after ~5 minutes. */
  expire: () => void;
  /** Fail the challenge outright. */
  fail: () => void;
  /** The site key the widget was rendered with. */
  sitekey: () => string | undefined;
  /** How many widgets have been rendered — one per challenge raised. */
  renderCount: () => number;
  uninstall: () => void;
};

export function installFakeTurnstile({ autoSolve = true }: { autoSolve?: boolean } = {}) {
  let live: RenderOptions | null = null;
  let renders = 0;
  let nextId = 0;

  window.turnstile = {
    render(_el, options) {
      live = options;
      renders += 1;
      if (autoSolve) options.callback(TEST_TURNSTILE_TOKEN);
      return `widget-${nextId++}`;
    },
    remove() {
      live = null;
    },
  };

  const fire = (pick: (o: RenderOptions) => () => void) => {
    if (!live) throw new Error("No Turnstile widget is rendered");
    const options = live;
    act(() => pick(options)());
  };

  return {
    solve: (token = TEST_TURNSTILE_TOKEN) => fire((o) => () => o.callback(token)),
    expire: () => fire((o) => o["expired-callback"]),
    fail: () => fire((o) => o["error-callback"]),
    sitekey: () => live?.sitekey,
    renderCount: () => renders,
    uninstall: () => {
      delete window.turnstile;
    },
  } satisfies FakeTurnstile;
}
