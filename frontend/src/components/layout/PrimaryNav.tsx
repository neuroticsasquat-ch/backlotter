import { NavLink } from "react-router";
import { NAV_ITEMS } from "@/components/layout/nav-items";

/** Inline primary navigation for wide viewports. Hidden below md, where the hamburger
 *  NavMenu takes over. */
export function PrimaryNav() {
  return (
    <nav aria-label="Primary navigation" className="hidden md:block">
      <ul className="flex items-center gap-4">
        {NAV_ITEMS.map((item) => (
          <li key={item.href}>
            <NavLink
              to={item.href}
              end={item.href === "/"}
              className={({ isActive }) =>
                isActive
                  ? "text-sm font-medium text-foreground"
                  : "text-sm text-muted-foreground transition-colors hover:text-foreground"
              }
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
