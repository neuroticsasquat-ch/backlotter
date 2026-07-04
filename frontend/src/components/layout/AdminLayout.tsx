import { NavLink, Outlet } from "react-router";
import { ADMIN_NAV_ITEMS } from "@/components/layout/admin-nav-items";

/** Chrome shared by all admin pages: a secondary tab strip above the routed page. Rendered
 *  inside RequireAdmin, so every child route is already admin-gated. Full-width so each page
 *  keeps its own content container. */
export function AdminLayout() {
  return (
    <>
      <nav aria-label="Admin navigation" className="border-b">
        <ul className="mx-auto flex max-w-5xl items-center gap-4 px-8">
          {ADMIN_NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <NavLink
                to={item.href}
                className={({ isActive }) =>
                  isActive
                    ? "inline-block border-b-2 border-foreground py-3 text-sm font-medium text-foreground"
                    : "inline-block border-b-2 border-transparent py-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </>
  );
}

export default AdminLayout;
