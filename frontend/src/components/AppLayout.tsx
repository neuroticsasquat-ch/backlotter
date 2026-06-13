import { Link, NavLink, Outlet } from "react-router";
import { useAuth } from "./AuthContext";

/** Authenticated app shell: a header with nav (admin entry shown only to admins) and
 * the routed page below. */
export function AppLayout() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <nav className="mx-auto flex max-w-4xl items-center gap-4 p-4">
          <Link to="/" className="font-semibold">
            Upcoming Movies
          </Link>
          <div className="flex-1" />
          {user?.is_admin && (
            <NavLink to="/admin/ingest" className="text-sm underline-offset-4 hover:underline">
              Admin
            </NavLink>
          )}
          {user && (
            <button onClick={() => logout()} className="text-sm underline-offset-4 hover:underline">
              Log out
            </button>
          )}
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
