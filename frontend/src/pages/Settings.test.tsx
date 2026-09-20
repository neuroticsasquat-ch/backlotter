import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { createRoutesStub } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/components/AuthContext";
import { env } from "@/env";
import { server } from "@/test/msw/server";
import { emailInUseResponse, invalidCredentialsResponse } from "@/test/msw/handlers";
import { meHandler } from "@/test/msw/me";
import { settingsHandlers } from "@/test/msw/settings";
import { Settings } from "./Settings";

function renderPage(
  me: Parameters<typeof meHandler>[0] = { entitled: true },
  settings = settingsHandlers(),
) {
  server.use(meHandler(me), ...settings.handlers);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Stub = createRoutesStub([
    { path: "/me/settings", Component: Settings },
    { path: "/me/follows", Component: () => <p>Follows page</p> },
    { path: "/feed", Component: () => <p>Global feed</p> },
  ]);
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Stub initialEntries={["/me/settings"]} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return settings;
}

/** The link the calendar panel shows: the API origin under the `webcal:` scheme. Spelled out
 *  here rather than imported from `lib/ical-url`, so a test would notice that module changing
 *  its mind about the shape of the URL. */
const webcalUrl = (token: string) =>
  `${env.apiBaseUrl.replace(/^https?:/, "webcal:")}/calendar/${token}.ics`;

describe("Settings", () => {
  describe("alert stores (D-44)", () => {
    it("shows the saved store set as the pressed chips", async () => {
      renderPage({ entitled: true }, settingsHandlers({ alert_stores: ["rent", "stream"] }));

      expect(await screen.findByRole("button", { name: "Rent alerts" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("button", { name: "Stream alerts" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("button", { name: "Buy alerts" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("turning a chip on PATCHes the whole canonical set", async () => {
      const settings = renderPage(
        { entitled: true },
        settingsHandlers({ alert_stores: ["stream"] }),
      );

      await userEvent.click(await screen.findByRole("button", { name: "Buy alerts" }));

      // Canonical order (buy, rent, stream), matching the backend's `normalise_alert_stores` —
      // not the order the user happened to click them in.
      await waitFor(() => expect(settings.patches).toEqual([{ alert_stores: ["buy", "stream"] }]));
      expect(settings.current().alert_stores).toEqual(["buy", "stream"]);
      expect(await screen.findByText(/saved/i)).toBeInTheDocument();
    });

    it("turning the last chip off is a real setting, not a no-op", async () => {
      const settings = renderPage(
        { entitled: true },
        settingsHandlers({ alert_stores: ["stream"] }),
      );

      await userEvent.click(await screen.findByRole("button", { name: "Stream alerts" }));

      await waitFor(() => expect(settings.current().alert_stores).toEqual([]));
    });

    it("puts the chips back when the save is refused", async () => {
      const settings = settingsHandlers({ alert_stores: ["stream"] });
      server.use(meHandler({ entitled: true }), ...settings.handlers);
      server.use(
        http.patch(`${env.apiBaseUrl}/me/settings`, () =>
          HttpResponse.json({ detail: "boom" }, { status: 500 }),
        ),
      );
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const Stub = createRoutesStub([{ path: "/me/settings", Component: Settings }]);
      render(
        <QueryClientProvider client={qc}>
          <AuthProvider>
            <Stub initialEntries={["/me/settings"]} />
          </AuthProvider>
        </QueryClientProvider>,
      );

      await userEvent.click(await screen.findByRole("button", { name: "Buy alerts" }));

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Buy alerts" })).toHaveAttribute(
          "aria-pressed",
          "false",
        ),
      );
    });
  });

  describe("digest cadence", () => {
    it("shows the saved cadence as the checked option", async () => {
      renderPage({ entitled: true }, settingsHandlers({ digest_cadence: "daily" }));

      expect(await screen.findByRole("radio", { name: /daily/i })).toBeChecked();
      expect(screen.getByRole("radio", { name: /weekly/i })).not.toBeChecked();
      expect(screen.getByRole("radio", { name: /off/i })).not.toBeChecked();
    });

    it("persists a change and reads it back", async () => {
      const settings = renderPage();

      expect(await screen.findByRole("radio", { name: /weekly/i })).toBeChecked();
      await userEvent.click(screen.getByRole("radio", { name: /off/i }));

      await waitFor(() => expect(settings.patches).toEqual([{ digest_cadence: "off" }]));
      expect(settings.current().digest_cadence).toBe("off");
      await waitFor(() => expect(screen.getByRole("radio", { name: /off/i })).toBeChecked());
      expect(await screen.findByText(/saved/i)).toBeInTheDocument();
    });

    it("puts the cadence back when the save is refused", async () => {
      const settings = settingsHandlers({ digest_cadence: "weekly" });
      server.use(meHandler({ entitled: true }), ...settings.handlers);
      server.use(
        http.patch(`${env.apiBaseUrl}/me/settings`, () =>
          HttpResponse.json({ detail: "boom" }, { status: 500 }),
        ),
      );
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const Stub = createRoutesStub([{ path: "/me/settings", Component: Settings }]);
      render(
        <QueryClientProvider client={qc}>
          <AuthProvider>
            <Stub initialEntries={["/me/settings"]} />
          </AuthProvider>
        </QueryClientProvider>,
      );

      expect(await screen.findByRole("radio", { name: /weekly/i })).toBeChecked();
      await userEvent.click(screen.getByRole("radio", { name: /daily/i }));

      // The server still says weekly, and the control has to agree with it once the request
      // has failed rather than keep showing a choice that did not land.
      await waitFor(() => expect(screen.getByRole("radio", { name: /weekly/i })).toBeChecked());
      expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
    });
  });

  describe("calendar (D-34)", () => {
    it("shows the tokenised webcal link and offers it to a calendar app", async () => {
      renderPage({ entitled: true }, settingsHandlers({ ical_token: "tok-mine" }));

      expect(await screen.findByLabelText(/your calendar link/i)).toHaveValue(
        webcalUrl("tok-mine"),
      );
      expect(screen.getByRole("link", { name: /subscribe/i })).toHaveAttribute(
        "href",
        webcalUrl("tok-mine"),
      );
      // The https spelling for the calendar apps that will not take an unknown scheme.
      expect(screen.getByRole("link", { name: /https version/i })).toHaveAttribute(
        "href",
        `${env.apiBaseUrl}/calendar/tok-mine.ics`,
      );
    });

    it("copies the link", async () => {
      const user = userEvent.setup();
      renderPage({ entitled: true }, settingsHandlers({ ical_token: "tok-mine" }));

      await user.click(await screen.findByRole("button", { name: /^copy$/i }));

      expect(await navigator.clipboard.readText()).toBe(webcalUrl("tok-mine"));
      expect(await screen.findByText(/copied/i)).toBeInTheDocument();
    });

    it("rotates the link behind a confirm, and the URL changes", async () => {
      const settings = renderPage({ entitled: true }, settingsHandlers({ ical_token: "tok-old" }));

      const field = await screen.findByLabelText(/your calendar link/i);
      expect(field).toHaveValue(webcalUrl("tok-old"));

      await userEvent.click(screen.getByRole("button", { name: /rotate link/i }));
      const dialog = await screen.findByRole("dialog");
      await userEvent.click(within(dialog).getByRole("button", { name: "Rotate" }));

      await waitFor(() => expect(settings.rotations()).toBe(1));
      await waitFor(() =>
        expect(screen.getByLabelText(/your calendar link/i)).toHaveValue(
          webcalUrl("tok-rotated-1"),
        ),
      );
      expect(settings.current().ical_token).toBe("tok-rotated-1");
    });

    it("sends nothing when the rotate confirm is cancelled", async () => {
      const settings = renderPage({ entitled: true }, settingsHandlers({ ical_token: "tok-old" }));

      await userEvent.click(await screen.findByRole("button", { name: /rotate link/i }));
      const dialog = await screen.findByRole("dialog");
      await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

      expect(settings.rotations()).toBe(0);
      expect(screen.getByLabelText(/your calendar link/i)).toHaveValue(webcalUrl("tok-old"));
    });

    it("takes 'Copied.' back down once the link it refers to has been rotated away", async () => {
      const user = userEvent.setup();
      renderPage({ entitled: true }, settingsHandlers({ ical_token: "tok-old" }));

      await user.click(await screen.findByRole("button", { name: /^copy$/i }));
      expect(await screen.findByText(/copied/i)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /rotate link/i }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Rotate" }));

      // The clipboard still holds the old URL, which is now dead — the page must not keep
      // claiming the link on screen is the one that was copied.
      await waitFor(() => expect(screen.queryByText(/copied/i)).not.toBeInTheDocument());
    });
  });

  describe("access (D-41)", () => {
    it("renders the delivery block and the subscriber links for an entitled account", async () => {
      renderPage({ entitled: true });

      expect(await screen.findByRole("heading", { name: /digest/i })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Alerts" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /follows/i })).toHaveAttribute("href", "/me/follows");
      expect(screen.getByRole("link", { name: /watchlist/i })).toHaveAttribute(
        "href",
        "/me/watchlist",
      );
      expect(screen.getByRole("link", { name: /redo onboarding/i })).toHaveAttribute(
        "href",
        "/welcome",
      );
      // The TMDB connect control, mounted here as NEU-1359 asked (settings *and* onboarding).
      expect(screen.getByRole("link", { name: /connect tmdb/i })).toBeInTheDocument();
      // The two delivery sections that are their own tickets: the calendar feed (NEU-1384)
      // and the push toggle (NEU-1388). Under jsdom the latter finds no push APIs and says
      // so, which is its "unsupported" branch — exercised properly in `PushSection.test.tsx`.
      expect(screen.getByRole("heading", { name: /calendar/i })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: /browser notifications/i })).toBeInTheDocument();
    });

    it("shows the account basics and a locked panel instead of the delivery block without a grant", async () => {
      const seen: string[] = [];
      server.use(
        http.get(`${env.apiBaseUrl}/me/settings`, () => {
          seen.push("settings");
          return HttpResponse.json({ detail: "entitlement_required" }, { status: 403 });
        }),
      );
      renderPage({ entitled: false, email: "locked@example.com" });

      // Keyed off the locked panel, which only renders once the account has resolved.
      expect(await screen.findByRole("heading", { name: /not open yet/i })).toBeInTheDocument();
      expect(screen.getByText("locked@example.com")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: /change your password/i })).toBeInTheDocument();
      expect(screen.queryByRole("radio")).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /connect tmdb/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /redo onboarding/i })).not.toBeInTheDocument();
      // Nothing was asked of a route that would only have answered 403.
      expect(seen).toEqual([]);
    });
  });

  describe("email", () => {
    it("shows the address and whether it is verified", async () => {
      renderPage({ entitled: true, email: "me@example.com", email_verified: false });

      expect(await screen.findByText("me@example.com")).toBeInTheDocument();
      expect(screen.getByText(/not verified/i)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /confirm it/i })).toHaveAttribute("href", "/verify");
    });

    it("asks for the new address and the password, then says where the link went", async () => {
      const seen: unknown[] = [];
      server.use(
        http.post(`${env.apiBaseUrl}/auth/email-change/request`, async ({ request }) => {
          seen.push(await request.json());
          return new HttpResponse(null, { status: 202 });
        }),
      );
      renderPage();

      const form = await screen.findByRole("form", { name: /change your email/i });
      await userEvent.type(within(form).getByLabelText(/new email/i), "new@example.com");
      await userEvent.type(within(form).getByLabelText(/current password/i), "hunter2hunter2");
      await userEvent.click(within(form).getByRole("button", { name: /send confirmation/i }));

      expect(await within(form).findByRole("status")).toHaveTextContent(/check new@example.com/i);
      expect(seen).toEqual([{ new_email: "new@example.com", current_password: "hunter2hunter2" }]);
    });

    it("says so when the password is wrong or the address is taken", async () => {
      server.use(
        http.post(`${env.apiBaseUrl}/auth/email-change/request`, async ({ request }) => {
          const body = (await request.json()) as { new_email: string };
          return body.new_email === "taken@example.com"
            ? emailInUseResponse()
            : invalidCredentialsResponse();
        }),
      );
      renderPage();

      const form = await screen.findByRole("form", { name: /change your email/i });
      const email = within(form).getByLabelText(/new email/i);
      const password = within(form).getByLabelText(/current password/i);
      const submit = within(form).getByRole("button", { name: /send confirmation/i });

      await userEvent.type(email, "new@example.com");
      await userEvent.type(password, "wrong-password");
      await userEvent.click(submit);
      expect(await within(form).findByRole("alert")).toHaveTextContent(/password/i);

      await userEvent.clear(email);
      await userEvent.type(email, "taken@example.com");
      await userEvent.click(submit);
      expect(await within(form).findByRole("alert")).toHaveTextContent(/already/i);
    });
  });

  describe("password", () => {
    it("changes the password and installs the rotated CSRF token", async () => {
      const seen: unknown[] = [];
      const csrf: (string | null)[] = [];
      renderPage();
      // Registered after the page's own handlers so these take precedence over them.
      server.use(
        http.post(`${env.apiBaseUrl}/auth/password`, async ({ request }) => {
          seen.push(await request.json());
          return HttpResponse.json({
            id: "u1",
            email: "a@b.com",
            display_name: "Test User",
            is_admin: false,
            email_verified: true,
            entitled: true,
            created_at: new Date().toISOString(),
            csrf_token: "rotated-csrf",
          });
        }),
        // Whatever mutation goes out next has to carry the token the password change handed
        // back, not the one the session started with.
        http.patch(`${env.apiBaseUrl}/me/settings`, ({ request }) => {
          csrf.push(request.headers.get("X-CSRF-Token"));
          return HttpResponse.json({
            digest_cadence: "daily",
            alert_stores: ["stream"],
            ical_token: "t",
            created_at: "",
            updated_at: "",
          });
        }),
      );

      const form = await screen.findByRole("form", { name: /change your password/i });
      await userEvent.type(within(form).getByLabelText(/current password/i), "hunter2hunter2");
      await userEvent.type(within(form).getByLabelText(/new password/i), "correct-horse-battery");
      await userEvent.click(within(form).getByRole("button", { name: /change password/i }));

      expect(await screen.findByText(/password changed/i)).toBeInTheDocument();
      expect(seen).toEqual([
        { current_password: "hunter2hunter2", new_password: "correct-horse-battery" },
      ]);

      await userEvent.click(screen.getByRole("radio", { name: /daily/i }));
      await waitFor(() => expect(csrf).toEqual(["rotated-csrf"]));
    });

    it("says so when the current password is wrong", async () => {
      server.use(http.post(`${env.apiBaseUrl}/auth/password`, () => invalidCredentialsResponse()));
      renderPage();

      const form = await screen.findByRole("form", { name: /change your password/i });
      await userEvent.type(within(form).getByLabelText(/current password/i), "nope-nope-nope");
      await userEvent.type(within(form).getByLabelText(/new password/i), "correct-horse-battery");
      await userEvent.click(within(form).getByRole("button", { name: /change password/i }));

      expect(await within(form).findByRole("alert")).toHaveTextContent(/password/i);
    });
  });
});
