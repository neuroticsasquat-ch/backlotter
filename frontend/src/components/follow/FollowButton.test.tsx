import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { createRoutesStub } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { server } from "@/test/msw/server";
import { env } from "@/env";
import { meHandler } from "@/test/msw/me";
import { entitlementRequiredHandlers, followGraphHandlers, makeFollow } from "@/test/msw/follows";
import { AuthProvider } from "@/components/AuthContext";
import type { FollowTarget } from "@/lib/film-entities";
import type { AuthedUser } from "@/api/types";
import { writeTimelineHint } from "@/lib/timeline-hint";
import { FollowButton } from "./FollowButton";

const TARGET: FollowTarget = {
  entityType: "person",
  entityId: "505710",
  label: "Christopher Nolan",
};

function renderButton(target: FollowTarget = TARGET) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Stub = createRoutesStub([
    { path: "/film/:ref", Component: () => <FollowButton target={target} /> },
    { path: "/login", Component: () => <p>Login page</p> },
  ]);
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Stub initialEntries={["/film/603-the-odyssey"]} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const follow = () => screen.findByRole("button", { name: /follow christopher nolan/i });

describe("FollowButton", () => {
  describe("signed out", () => {
    it("offers the button as a sign-in prompt back to the page it is on", async () => {
      // The default /me handler answers 401.
      renderButton();
      const link = await screen.findByRole("link", {
        name: /sign in to follow christopher nolan/i,
      });
      expect(link).toHaveTextContent("Follow");
      expect(link).toHaveAttribute("href", "/login?next=%2Ffilm%2F603-the-odyssey");
    });
  });

  describe("with the timeline hint while /me is in flight", () => {
    it("keeps its signed-out form: the hint predicts, it does not sign anyone in", async () => {
      // `hinted` is a home-page and nav state only (NEU-1468, D-1468.5); a live follow control
      // on a prediction would be a button that 401s.
      writeTimelineHint({ entitled: true } as AuthedUser);
      server.use(
        http.get(`${env.apiBaseUrl}/me`, async () => {
          await delay(100);
          return HttpResponse.json({ detail: "auth_required" }, { status: 401 });
        }),
      );
      renderButton();

      // Synchronous on purpose: the window under test closes when `/me` answers.
      expect(
        screen.getByRole("link", { name: /sign in to follow christopher nolan/i }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /follow christopher nolan/i })).toBeNull();
    });
  });

  describe("signed in without a grant", () => {
    it("renders the button disabled, explaining that access is limited", async () => {
      server.use(meHandler({ entitled: false }), ...entitlementRequiredHandlers());
      renderButton();

      const button = await follow();
      await waitFor(() => expect(button).toBeDisabled());
      expect(button.parentElement).toHaveAttribute(
        "title",
        expect.stringContaining("Access is limited while we build that tier"),
      );
      // Not "upgrade now": there is nothing to buy yet (D-41).
      expect(button.parentElement?.getAttribute("title")).not.toMatch(/upgrade/i);
    });
  });

  describe("signed in with a grant", () => {
    it("follows on click and flips to Following", async () => {
      const graph = followGraphHandlers();
      server.use(meHandler({ entitled: true }), ...graph.handlers);
      renderButton();

      await userEvent.click(await follow());

      expect(
        await screen.findByRole("button", { name: /unfollow christopher nolan/i }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(graph.follows).toEqual([
        expect.objectContaining({ entity_type: "person", entity_id: "505710" }),
      ]);
    });

    it("unfollows a target the user already follows", async () => {
      const graph = followGraphHandlers({
        follows: [makeFollow({ entity_id: "505710", name: "Denis Villeneuve" })],
      });
      server.use(meHandler({ entitled: true }), ...graph.handlers);
      renderButton();

      await userEvent.click(await screen.findByRole("button", { name: /unfollow/i }));

      expect(await follow()).toHaveAttribute("aria-pressed", "false");
      expect(graph.follows).toEqual([]);
    });

    it("rolls back and re-reads the account when the grant lapsed mid-session", async () => {
      // A grant that ends between page load and click shows up as the 403 and nowhere else:
      // the cached account still says entitled. The second /me read is what reports the lapse.
      let meReads = 0;
      server.use(
        http.get(`${env.apiBaseUrl}/me`, () => {
          const entitled = meReads === 0;
          meReads += 1;
          return HttpResponse.json({
            id: "u1",
            email: "a@b.com",
            display_name: "Test User",
            is_admin: false,
            email_verified: true,
            entitled,
            created_at: "2026-01-01T00:00:00Z",
            csrf_token: "test-csrf",
          });
        }),
        ...entitlementRequiredHandlers(),
      );
      renderButton();

      await userEvent.click(await follow());

      // The optimistic "Following" is undone rather than left lying, and the button settles
      // into its locked state instead of raising an error.
      await waitFor(() => expect(screen.getByRole("button")).toBeDisabled());
      expect(screen.getByRole("button")).toHaveTextContent("Follow");
      expect(meReads).toBeGreaterThan(1);
    });

    it("keeps each button's state its own when a neighbouring write fails", async () => {
      // A film page carries a dozen of these, and the rollback undoes the one entity that
      // failed rather than restoring a snapshot of the whole list. The end state here is the
      // server's either way — the snapshot's damage is a flicker, not a lasting wrong answer —
      // so this pins the behaviour a reader would check by hand: one failure, one button moved.
      // Registered ahead of the stateful handlers: it fails the second entity and, for the
      // first, stalls and then falls through to the real one, so the two writes overlap.
      const graph = followGraphHandlers();
      server.use(
        meHandler({ entitled: true }),
        http.post(`${env.apiBaseUrl}/me/follows`, async ({ request }) => {
          const body = (await request.clone().json()) as { entity_id: string };
          if (body.entity_id === "2") return HttpResponse.error();
          await delay(20);
          return undefined;
        }),
        ...graph.handlers,
      );

      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const Stub = createRoutesStub([
        {
          path: "/film/:ref",
          Component: () => (
            <>
              <FollowButton target={{ entityType: "person", entityId: "1", label: "Kept" }} />
              <FollowButton target={{ entityType: "person", entityId: "2", label: "Failed" }} />
            </>
          ),
        },
      ]);
      render(
        <QueryClientProvider client={qc}>
          <AuthProvider>
            <Stub initialEntries={["/film/603-the-odyssey"]} />
          </AuthProvider>
        </QueryClientProvider>,
      );

      await userEvent.click(await screen.findByRole("button", { name: /^follow kept$/i }));
      await userEvent.click(screen.getByRole("button", { name: /^follow failed$/i }));

      expect(await screen.findByRole("button", { name: /^unfollow kept$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^follow failed$/i })).toBeInTheDocument();
      expect(graph.follows).toEqual([expect.objectContaining({ entity_id: "1" })]);
    });
  });
});
