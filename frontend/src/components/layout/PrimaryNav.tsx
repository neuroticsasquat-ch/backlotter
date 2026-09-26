import { NavLink } from "react-router";
import { useFollowAccess } from "@/components/follow/access";
import { navItemsFor } from "@/components/layout/nav-items";

/** Inline primary navigation for wide viewports. Hidden below md, where the hamburger
 *  NavMenu takes over.
 *
 *  Reads `useFollowAccess` for the same reason `TimelineOrFeed` does: what `/` leads to
 *  depends on whether the reader has a timeline, and so does whether `/feed` is worth naming
 *  separately. `PublicLayout` wraps the header in `AuthProvider`, so this is in scope here. */
export function PrimaryNav() {
  const access = useFollowAccess();

  return (
    <nav aria-label="Primary navigation" className="hidden md:block">
      {/* `shrink-0` + `whitespace-nowrap` are load-bearing, not cosmetic: without them a row
          that runs out of room compresses each item until its label breaks mid-phrase rather
          than overflowing visibly. That is how "Log out" once rendered 27px wide as a stacked
          "Log"/"out". Nothing here may wrap, whatever gets added later. */}
      <ul className="flex items-center gap-4">
        {navItemsFor(access).map((item) => (
          <li key={item.href} className="shrink-0">
            <NavLink
              to={item.href}
              end={item.href === "/"}
              className={({ isActive }) =>
                isActive
                  ? "whitespace-nowrap text-sm font-medium text-foreground"
                  : "whitespace-nowrap text-sm text-muted-foreground transition-colors hover:text-foreground"
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
