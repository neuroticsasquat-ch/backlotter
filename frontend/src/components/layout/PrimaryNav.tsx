import { NavLink } from "react-router";
import { NAV_ITEMS } from "@/components/layout/nav-items";

/** Primary site navigation. Enabled items render as NavLinks; disabled items render
 * as inert span placeholders (aria-disabled, not focusable). */
export function PrimaryNav() {
  return (
    <nav aria-label="Primary navigation">
      <ul className="flex items-center gap-4">
        {NAV_ITEMS.map((item) =>
          item.enabled ? (
            <li key={item.href}>
              <NavLink
                to={item.href}
                className={({ isActive }) =>
                  isActive
                    ? "font-medium underline underline-offset-4"
                    : "text-muted-foreground hover:text-foreground transition-colors"
                }
              >
                {item.label}
              </NavLink>
            </li>
          ) : (
            <li key={item.href}>
              <span
                aria-disabled="true"
                tabIndex={-1}
                className="text-muted-foreground/50 cursor-not-allowed select-none"
              >
                {item.label}
              </span>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}
