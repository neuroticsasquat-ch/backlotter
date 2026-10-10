import { Link, matchPath, useLocation } from "react-router";
import type { NavItem } from "@/components/layout/nav-items";

/** One primary-nav item, for both the inline nav and the mobile menu. A `NavLink` would light
 *  only on `href`'s own subtree, and the Calendar item for an entitled reader links to
 *  `/calendar/my-films` while being the current page on `/calendar` too (NEU-1544) — so the
 *  active state is matched against `activePath` instead. `/` lights on itself alone, as `end`
 *  did on the `NavLink`. */
export function NavItemLink({
  item,
  className,
}: {
  item: NavItem;
  className: (state: { isActive: boolean }) => string;
}) {
  const { pathname } = useLocation();
  const isActive =
    matchPath({ path: item.activePath ?? item.href, end: item.href === "/" }, pathname) !== null;
  return (
    <Link
      to={item.href}
      aria-current={isActive ? "page" : undefined}
      className={className({ isActive })}
    >
      {item.label}
    </Link>
  );
}
