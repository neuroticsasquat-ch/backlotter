import { useRef } from "react";
import { Link, useLocation } from "react-router";
import * as Popover from "@radix-ui/react-popover";
import type { AuthedUser } from "@/api/types";
import { Avatar } from "@/components/ui/avatar";

/** Shared by both states so the control does not shift when the account resolves. */
const triggerClass =
  "flex shrink-0 rounded-full transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const panelClass = "z-50 w-56 rounded-md border border-border bg-background p-1 shadow-lg";

/**
 * The account control in the wide-viewport header: an avatar that opens a menu.
 *
 * It replaces seven inline text links — name, Follows, Watchlist, Redo onboarding, Settings,
 * Admin, Log out — that used to sit in the header row at the same weight and spacing as the
 * site navigation beside them. Ten items could not fit the header's `max-w-4xl` measure at
 * *any* desktop width, so they compressed until the labels broke mid-phrase ("Log out"
 * rendered 27px wide, stacked). Folding them behind one control takes the row to four items
 * and leaves room to spare.
 *
 * A **Popover, not a Radix DropdownMenu**: the contents are mostly navigation links, and
 * `role="menu"`/`menuitem` would strip their link semantics — a screen reader would stop
 * announcing them as links and stop offering them in its links list. A popover holding an
 * ordinary `<nav>` keeps that, is Tab-navigable as users expect of links, and still gets
 * focus return, Escape-to-close and outside-click from Radix.
 *
 * Every row is wrapped in `Popover.Close`. Radix closes on outside click and Escape, but a
 * link *inside* the panel navigates without either, which would leave the menu hanging open
 * over the page it just opened. Closing from the click that caused it keeps this component
 * stateless — the alternative, watching the location and calling `setOpen` from an effect,
 * is a cascading render for something the event already tells us.
 */
export function AccountMenu({ user, onLogout }: { user: AuthedUser | null; onLogout: () => void }) {
  const navRef = useRef<HTMLElement>(null);
  const { pathname, search } = useLocation();
  const itemClass =
    "block w-full rounded px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

  // An anonymous visitor gets the same control in the same place, holding the one thing
  // they can do. The alternative the header used to take — rendering nothing at all — left
  // no way into the app from the site itself; the admin had to type /login. A Sign up item
  // joins this once there is a subscription to sell (NEU-1409).
  if (!user) {
    return (
      <Popover.Root>
        <Popover.Trigger aria-label="Account menu" className={triggerClass}>
          <Avatar />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="end" sideOffset={8} className={panelClass}>
            <nav aria-label="Account navigation" className="py-1">
              <ul className="flex flex-col">
                <li>
                  <Popover.Close asChild>
                    {/* `next` so signing in returns the reader to the page they were on,
                        the same contract `SignInToggle` uses on the follow buttons. */}
                    <Link
                      to={`/login?next=${encodeURIComponent(pathname + search)}`}
                      className={itemClass}
                    >
                      Log in
                    </Link>
                  </Popover.Close>
                </li>
              </ul>
            </nav>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  return (
    <Popover.Root>
      <Popover.Trigger aria-label={`${user.display_name} — account menu`} className={triggerClass}>
        <Avatar displayName={user.display_name} email={user.email} />
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          // Left to itself, Radix puts focus on the panel's *last* focusable child — which
          // here is Log out, so opening the menu and pressing Enter signed the user out. The
          // first item is both the conventional place for focus to land and the one that
          // keeps a destructive action out from under the keyboard. Queried rather than
          // ref'd per item because which item comes first depends on the account: an
          // unentitled one has no collections, so its menu starts at Settings.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            navRef.current?.querySelector<HTMLElement>("a, button")?.focus();
          }}
          className={panelClass}
        >
          {/* Who you are signed in as. The email is here rather than in the trigger because
              it is the thing that disambiguates two accounts, and it is too long for a row
              that has to stay compact. */}
          <div className="border-b border-border px-3 py-2">
            <p className="truncate text-sm font-medium text-foreground">{user.display_name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>

          <nav ref={navRef} aria-label="Account navigation" className="py-1">
            <ul className="flex flex-col">
              {/* Hidden rather than rendered dead for an account without access (D-41): the
                  follow buttons on a film page are the surface that argues for the
                  subscription, and they do it in context. */}
              {user.entitled && (
                <>
                  <li>
                    <Popover.Close asChild>
                      <Link to="/me/follows" className={itemClass}>
                        Follows
                      </Link>
                    </Popover.Close>
                  </li>
                  <li>
                    <Popover.Close asChild>
                      <Link to="/me/watchlist" className={itemClass}>
                        Watchlist
                      </Link>
                    </Popover.Close>
                  </li>
                  <li>
                    {/* The way back into onboarding (D-17), beside the two collections it
                        fills and gated with them. */}
                    <Popover.Close asChild>
                      <Link to="/welcome" className={itemClass}>
                        Redo onboarding
                      </Link>
                    </Popover.Close>
                  </li>
                </>
              )}
              {/* Not gated: the address and password on that page belong to every signed-in
                  account, and it is the one place an account without a grant can change them. */}
              <li>
                <Popover.Close asChild>
                  <Link to="/me/settings" className={itemClass}>
                    Settings
                  </Link>
                </Popover.Close>
              </li>
              {user.is_admin && (
                <li>
                  <Popover.Close asChild>
                    <Link to="/admin/ingest" className={itemClass}>
                      Admin
                    </Link>
                  </Popover.Close>
                </li>
              )}
            </ul>
          </nav>

          {/* Separated, because it is the one item here that is not navigation. */}
          <div className="border-t border-border pt-1">
            <Popover.Close asChild>
              <button type="button" onClick={onLogout} className={itemClass}>
                Log out
              </button>
            </Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
