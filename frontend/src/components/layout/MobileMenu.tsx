import { useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router";
import { NAV_ITEMS } from "@/components/layout/nav-items";
import HeaderAccount from "@/components/layout/HeaderAccount";

/**
 * Collapsed navigation menu (all viewports): a <details> disclosure holding the nav
 * links plus the account island (Log in / account). Native <details> keeps it usable
 * without JS; a small client enhancement closes it on outside-click and on navigation
 * (so it never lingers open over a new page or after clicking elsewhere).
 */
export function NavMenu() {
  const ref = useRef<HTMLDetailsElement>(null);
  const location = useLocation();

  // Close when the route changes — e.g. picking a menu link loads a new page.
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [location.key]);

  // Close when the user presses anywhere outside the menu.
  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      const el = ref.current;
      if (el?.open && !el.contains(e.target as Node)) el.open = false;
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    isActive
      ? "block rounded px-3 py-2 text-sm font-medium hover:bg-muted"
      : "block rounded px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground";

  return (
    <details ref={ref} className="relative md:hidden">
      <summary
        aria-label="Open menu"
        className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md text-foreground hover:bg-muted [&::-webkit-details-marker]:hidden"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </svg>
      </summary>
      <div className="absolute right-0 top-full z-50 mt-2 w-48 rounded-md border border-border bg-background p-1 shadow-lg">
        <nav aria-label="Mobile navigation">
          <ul className="flex flex-col">
            {NAV_ITEMS.map((item) =>
              item.enabled ? (
                <li key={item.href}>
                  <NavLink to={item.href} end={item.href === "/"} className={linkClass}>
                    {item.label}
                  </NavLink>
                </li>
              ) : (
                <li key={item.href}>
                  <span
                    aria-disabled="true"
                    tabIndex={-1}
                    className="block cursor-not-allowed select-none px-3 py-2 text-sm text-muted-foreground/50"
                  >
                    {item.label}
                  </span>
                </li>
              ),
            )}
          </ul>
        </nav>
        {/* Account island self-renders its own separator, and only when signed in. */}
        <HeaderAccount />
      </div>
    </details>
  );
}
