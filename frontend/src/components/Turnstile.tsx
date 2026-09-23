import { useEffect, useRef } from "react";

import { env } from "@/env";

/**
 * The Cloudflare Turnstile widget, rendered explicitly (NEU-1345, D-18).
 *
 * Explicit rendering rather than the `cf-turnstile` auto-render class: auto-render scans the
 * document once when the script loads, which under a client-side router means it finds
 * nothing at all on any navigation into `/signup` after the first paint. Rendering from an
 * effect against a ref is the only variant that survives being mounted whenever the router
 * feels like it.
 *
 * **The token is single-use.** Cloudflare's siteverify spends it, so a signup that fails for
 * any reason -- a taken email, a 429, a bad invite -- cannot be retried with the token
 * already in hand. The caller's fix is to remount this component (a changing `key`), which
 * tears the widget down and raises a fresh challenge; there is deliberately no imperative
 * `reset()` handle to get wrong.
 */

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type RenderOptions = {
  sitekey: string;
  callback: (token: string) => void;
  "error-callback": () => void;
  "expired-callback": () => void;
};

type TurnstileApi = {
  render: (el: HTMLElement, options: RenderOptions) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;

/**
 * Load `api.js` once per document, and resolve immediately if something already has.
 *
 * The promise is cached so a remount doesn't append a second `<script>`, but a *failed* load
 * clears the cache: a user who signs up through a blip in their connection should get a real
 * second attempt, not a replay of the first failure.
 */
function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => {
      scriptPromise = null;
      script.remove();
      reject(new Error("Turnstile script failed to load"));
    });
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function Turnstile({
  onToken,
  onUnavailable,
}: {
  /** A solved challenge, or `null` when the token expired or the widget errored. */
  onToken: (token: string | null) => void;
  /** The widget could not be shown at all — script blocked, or Cloudflare erroring. */
  onUnavailable?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Held in refs so the effect can stay on `[]` and render the widget exactly once. Reading
  // the callbacks through a ref keeps a parent re-render (every keystroke in the signup
  // form) from tearing down and re-raising the challenge.
  const onTokenRef = useRef(onToken);
  const onUnavailableRef = useRef(onUnavailable);
  // Refreshed from an effect rather than during render, which the React rules forbid. It is
  // unconditional (no dependency array) on purpose: this must run after *every* render, and
  // it is declared above the widget effect so that on mount it lands first.
  useEffect(() => {
    onTokenRef.current = onToken;
    onUnavailableRef.current = onUnavailable;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // No site key means the build never got VITE_TURNSTILE_SITE_KEY (`env.ts` refuses to
    // guess one outside dev). Say so rather than rendering an empty box: the caller shows
    // the user a failure and blocks the submit, and the console line names the variable for
    // whoever has to fix the deploy.
    if (!env.turnstileSiteKey) {
      console.error("VITE_TURNSTILE_SITE_KEY is not set; the signup bot check cannot render.");
      onUnavailableRef.current?.();
      return;
    }
    let cancelled = false;
    let widgetId: string | null = null;

    loadTurnstileScript()
      .then(() => {
        // `cancelled` covers React's development double-invoke: without it the first pass
        // renders a widget whose id the cleanup has already stopped being able to see.
        if (cancelled || !window.turnstile) return;
        widgetId = window.turnstile.render(container, {
          sitekey: env.turnstileSiteKey,
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => {
            onTokenRef.current(null);
            onUnavailableRef.current?.();
          },
        });
      })
      .catch(() => {
        if (!cancelled) onUnavailableRef.current?.();
      });

    return () => {
      cancelled = true;
      if (widgetId !== null) window.turnstile?.remove(widgetId);
    };
  }, []);

  return <div ref={containerRef} data-testid="turnstile" />;
}

export default Turnstile;
