import { afterEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { server } from "@/test/msw/server";
import { pushHandlers, VAPID_PUBLIC_KEY } from "@/test/msw/push";
import {
  fakeSubscription,
  installPushEnv,
  type PushEnv,
  type PushEnvOptions,
} from "@/test/push-env";
import { urlBase64ToUint8Array } from "@/lib/push-support";
import { PushSection } from "./PushSection";

let env: PushEnv | null = null;
afterEach(() => {
  env?.restore();
  env = null;
});

function renderSection(opts: PushEnvOptions = {}, push = pushHandlers()) {
  env = installPushEnv(opts);
  server.use(...push.handlers);
  render(<PushSection className="section" />);
  return push;
}

const toggle = (name: RegExp) => screen.findByRole("button", { name });

describe("PushSection", () => {
  describe("a browser that supports push", () => {
    it("subscribes from the toggle and registers the endpoint", async () => {
      const push = renderSection({ subscribeResult: fakeSubscription("https://push.example/a") });

      await userEvent.click(await toggle(/turn on notifications/i));

      await waitFor(() => expect(push.endpoints()).toEqual(["https://push.example/a"]));
      expect(push.subscribes[0]).toEqual({
        endpoint: "https://push.example/a",
        keys: {
          p256dh: "p256dh-https://push.example/a",
          auth: "auth-https://push.example/a",
        },
      });
      expect(await screen.findByText(/on for this device/i)).toBeInTheDocument();
      expect(await toggle(/turn off notifications/i)).toBeInTheDocument();
    });

    /** iOS rejects a permission prompt that did not come out of the user's own gesture, so
     *  the call has to be the first thing the click handler does. */
    it("asks for permission from the click itself", async () => {
      renderSection();

      await userEvent.click(await toggle(/turn on notifications/i));

      expect(env!.requestPermission).toHaveBeenCalled();
    });

    it("subscribes with the deployment's VAPID key", async () => {
      renderSection();

      await userEvent.click(await toggle(/turn on notifications/i));

      await waitFor(() => expect(env!.subscribe).toHaveBeenCalled());
      const options = env!.subscribe.mock.calls[0][0] as {
        userVisibleOnly: boolean;
        applicationServerKey: Uint8Array;
      };
      expect(options.userVisibleOnly).toBe(true);
      expect(Array.from(options.applicationServerKey)).toEqual(
        Array.from(urlBase64ToUint8Array(VAPID_PUBLIC_KEY)),
      );
    });

    /**
     * The worker is registered carrying the API origin, which it will still need weeks later
     * when `pushsubscriptionchange` fires with no page open. The VAPID key is deliberately
     * *not* in the URL: a registration written months ago would pin a key the deployment may
     * have rotated away from, so the worker fetches the live one at rotation time.
     */
    it("registers the worker with the api origin, and no pinned key, in its url", async () => {
      renderSection();

      await userEvent.click(await toggle(/turn on notifications/i));

      await waitFor(() => expect(env!.register).toHaveBeenCalled());
      const url = env!.register.mock.calls[0][0] as string;
      expect(url.startsWith("/sw.js?")).toBe(true);
      const params = new URLSearchParams(url.slice(url.indexOf("?")));
      expect(params.get("api")).toBeTruthy();
      expect(params.get("key")).toBeNull();
      expect(url).not.toContain(VAPID_PUBLIC_KEY);
    });

    it("unsubscribes from the toggle and clears the registration", async () => {
      const existing = fakeSubscription("https://push.example/held");
      const push = renderSection({ existing });

      await userEvent.click(await toggle(/turn off notifications/i));

      await waitFor(() => expect(push.unsubscribes).toEqual(["https://push.example/held"]));
      expect(push.endpoints()).toEqual([]);
      expect(existing.unsubscribe).toHaveBeenCalled();
      expect(await screen.findByText(/off for this device/i)).toBeInTheDocument();
    });

    it("shows the held subscription as on when the panel opens", async () => {
      renderSection({ existing: fakeSubscription("https://push.example/held") });

      expect(await toggle(/turn off notifications/i)).toBeInTheDocument();
    });

    /**
     * The heal for a rotation the worker could not report: it cannot sign its own request on
     * a browser without `cookieStore`, so the panel re-posts whatever this browser holds
     * every time it mounts. `POST /me/push` is idempotent by endpoint, so this is free.
     */
    it("re-posts the held subscription on mount", async () => {
      const push = renderSection({ existing: fakeSubscription("https://push.example/held") });

      await waitFor(() => expect(push.endpoints()).toEqual(["https://push.example/held"]));
      expect(push.subscribes).toHaveLength(1);
    });

    it("says so when the user refuses the prompt", async () => {
      renderSection({ promptResult: "denied" });

      await userEvent.click(await toggle(/turn on notifications/i));

      expect(await screen.findByRole("alert")).toHaveTextContent(/blocked for this site/i);
    });

    // Already refused, before this visit: there is no prompt left to offer.
    it("offers no toggle when notifications are already blocked", async () => {
      renderSection({ permission: "denied" });

      expect(await screen.findByText(/blocked for this site/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /turn on notifications/i })).toBeNull();
    });

    it("reports a deployment with no push keys as such", async () => {
      renderSection({}, pushHandlers({ configured: false }));

      await userEvent.click(await toggle(/turn on notifications/i));

      expect(await screen.findByRole("alert")).toHaveTextContent(/not switched on/i);
    });

    it("reports a refused subscribe without claiming it worked", async () => {
      const push = renderSection({ subscribeResult: new Error("no push service") });

      await userEvent.click(await toggle(/turn on notifications/i));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        /could not turn notifications on/i,
      );
      expect(push.endpoints()).toEqual([]);
      expect(await toggle(/turn on notifications/i)).toBeInTheDocument();
    });
  });

  /**
   * The install funnel. An uninstalled iPhone can do this — one Add to Home Screen away — so
   * it gets steps, not the "your browser cannot" sentence.
   */
  describe("an iPhone that is not installed", () => {
    it("renders the install steps instead of a toggle", async () => {
      renderSection({ ios: true, standalone: false });

      expect(await screen.findByText(/add to home screen/i)).toBeInTheDocument();
      expect(screen.getByText(/share/i)).toBeInTheDocument();
      // The step people miss: an icon opened from Safari is still a tab.
      expect(screen.getByText(/not from your browser/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /turn on notifications/i })).toBeNull();
    });

    it("does not tell the user their browser is unsupported", async () => {
      renderSection({ ios: true, standalone: false });

      await screen.findByText(/add to home screen/i);
      expect(screen.queryByText(/does not support push notifications/i)).toBeNull();
    });

    it("offers the toggle once it is installed", async () => {
      renderSection({ ios: true, standalone: true });

      expect(await toggle(/turn on notifications/i)).toBeInTheDocument();
      expect(screen.queryByText(/add to home screen/i)).toBeNull();
    });
  });

  describe("a browser that cannot do push at all", () => {
    it("says so, and offers no steps that would not help", async () => {
      renderSection({ unsupported: true });

      expect(await screen.findByText(/does not support push notifications/i)).toBeInTheDocument();
      expect(screen.queryByText(/add to home screen/i)).toBeNull();
      expect(screen.queryByRole("button", { name: /turn on notifications/i })).toBeNull();
    });
  });
});
