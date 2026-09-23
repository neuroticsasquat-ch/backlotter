import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import type { AuthedUser } from "@/api/types";
import { AccountMenu } from "./AccountMenu";

function makeUser(overrides: Partial<AuthedUser> = {}): AuthedUser {
  return {
    id: "u1",
    email: "tom@tomboone.com",
    display_name: "Tom Boone",
    is_admin: false,
    email_verified: true,
    entitled: true,
    created_at: "2026-01-01T00:00:00Z",
    csrf_token: "test-csrf",
    ...overrides,
  };
}

function renderMenu(user: Partial<AuthedUser> = {}, onLogout = vi.fn()) {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <AccountMenu user={makeUser(user)} onLogout={onLogout} /> },
    { path: "/me/settings", Component: () => <p>Settings page</p> },
  ]);
  render(<Stub initialEntries={["/"]} />);
  return { onLogout };
}

/** The anonymous case: no account at all. */
function renderAnonymous(at = "/film/wicked") {
  const Stub = createRoutesStub([
    { path: "*", Component: () => <AccountMenu user={null} onLogout={vi.fn()} /> },
  ]);
  render(<Stub initialEntries={[at]} />);
}

const trigger = () => screen.getByRole("button", { name: /account menu/i });
const openMenu = async () => userEvent.click(trigger());

describe("AccountMenu", () => {
  describe("the trigger", () => {
    it("shows the account's initials", () => {
      renderMenu();
      expect(trigger()).toHaveTextContent("TB");
    });

    /** The initials are decorative; the name has to reach a screen reader some other way. */
    it("names itself for a screen reader", () => {
      renderMenu();
      expect(trigger()).toHaveAccessibleName("Tom Boone — account menu");
    });

    it("reports whether the menu is open", async () => {
      renderMenu();
      expect(trigger()).toHaveAttribute("aria-expanded", "false");
      await openMenu();
      expect(trigger()).toHaveAttribute("aria-expanded", "true");
    });
  });

  describe("what the menu holds", () => {
    it("keeps everything out of the header until it is opened", () => {
      renderMenu();
      expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
      expect(screen.queryByRole("button", { name: /log out/i })).toBeNull();
    });

    it("shows who is signed in", async () => {
      renderMenu();
      await openMenu();
      expect(screen.getByText("Tom Boone")).toBeInTheDocument();
      expect(screen.getByText("tom@tomboone.com")).toBeInTheDocument();
    });

    it("links an entitled account to its follows, and offers no Watchlist (EF-14)", async () => {
      renderMenu({ entitled: true });
      await openMenu();
      expect(screen.getByRole("link", { name: "Follows" })).toHaveAttribute("href", "/me/follows");
      expect(screen.queryByRole("link", { name: "Watchlist" })).toBeNull();
      expect(screen.getByRole("link", { name: /redo onboarding/i })).toHaveAttribute(
        "href",
        "/welcome",
      );
    });

    /** D-41: hidden, not rendered dead — a nav entry that only reaches a locked panel is
     *  not the surface that should be arguing for the subscription. */
    it("hides them from an account without a grant", async () => {
      renderMenu({ entitled: false });
      await openMenu();
      expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Follows" })).toBeNull();
      expect(screen.queryByRole("link", { name: /redo onboarding/i })).toBeNull();
    });

    it("offers Settings to every signed-in account, grant or not", async () => {
      renderMenu({ entitled: false });
      await openMenu();
      expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
        "href",
        "/me/settings",
      );
    });

    it("shows Admin only to an admin", async () => {
      renderMenu({ is_admin: true });
      await openMenu();
      expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin/ingest");
    });

    it("hides Admin from everyone else", async () => {
      renderMenu({ is_admin: false });
      await openMenu();
      expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
    });

    /**
     * The links stay links. A Radix `DropdownMenu` would give them `role="menuitem"`, which
     * takes them out of a screen reader's links list and stops them being announced as
     * links at all — so the panel is a popover holding an ordinary nav instead.
     */
    it("keeps the destinations as real links, not menu items", async () => {
      renderMenu();
      await openMenu();
      expect(screen.getByRole("navigation", { name: /account navigation/i })).toBeInTheDocument();
      expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
    });
  });

  /**
   * An anonymous visitor gets the same control in the same place. The header used to render
   * nothing for them, which left no way into the app from the site itself.
   */
  describe("an anonymous visitor", () => {
    it("still gets an account menu", () => {
      renderAnonymous();
      expect(screen.getByRole("button", { name: /^account menu$/i })).toBeInTheDocument();
    });

    // There is no name or address to take initials from, so the avatar is a figure.
    it("shows no initials on the avatar", () => {
      renderAnonymous();
      expect(screen.getByRole("button", { name: /^account menu$/i })).toHaveTextContent("");
    });

    it("offers Log in, and returns to the page they were on", async () => {
      renderAnonymous("/film/wicked");
      await userEvent.click(screen.getByRole("button", { name: /^account menu$/i }));

      const login = screen.getByRole("link", { name: /log in/i });
      expect(login).toHaveAttribute("href", `/login?next=${encodeURIComponent("/film/wicked")}`);
    });

    /** Sign up waits for there to be a subscription to sell (NEU-1409); the account links
     *  obviously have no meaning without an account. */
    it("offers nothing else", async () => {
      renderAnonymous();
      await userEvent.click(screen.getByRole("button", { name: /^account menu$/i }));

      expect(screen.queryByRole("link", { name: /sign up/i })).toBeNull();
      expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
      expect(screen.queryByRole("button", { name: /log out/i })).toBeNull();
    });
  });

  describe("focus on open", () => {
    /**
     * Radix hands focus to the last focusable child of the panel by default, which here is
     * Log out — so opening the menu and pressing Enter signed you out. Focus goes to the
     * first item instead: a destructive action must never be the thing sitting under the
     * keyboard the instant a menu appears.
     */
    it("does not land on Log out", async () => {
      renderMenu();
      await openMenu();

      await waitFor(() =>
        expect(document.activeElement).not.toBe(screen.getByRole("button", { name: /log out/i })),
      );
    });

    it("lands on the first item in the menu", async () => {
      renderMenu({ entitled: true });
      await openMenu();

      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByRole("link", { name: "Follows" })),
      );
    });

    /** The first item is not always the same one — an account without a grant has no
     *  collections, so Settings is the top of its menu. */
    it("lands on the first item an unentitled account actually has", async () => {
      renderMenu({ entitled: false });
      await openMenu();

      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByRole("link", { name: "Settings" })),
      );
    });
  });

  describe("logging out", () => {
    it("calls back and closes", async () => {
      const { onLogout } = renderMenu();
      await openMenu();
      await userEvent.click(screen.getByRole("button", { name: /log out/i }));

      expect(onLogout).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole("button", { name: /log out/i })).toBeNull());
    });
  });

  describe("closing", () => {
    it("closes on Escape", async () => {
      renderMenu();
      await openMenu();
      expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();

      await userEvent.keyboard("{Escape}");

      await waitFor(() => expect(screen.queryByRole("link", { name: "Settings" })).toBeNull());
    });

    /** Radix closes on outside click and Escape, but a link inside navigates without
     *  either — the menu would otherwise hang open over the page it just opened. */
    it("closes when a link inside it navigates", async () => {
      renderMenu();
      await openMenu();
      await userEvent.click(screen.getByRole("link", { name: "Settings" }));

      expect(await screen.findByText("Settings page")).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole("link", { name: "Settings" })).toBeNull());
    });
  });
});
