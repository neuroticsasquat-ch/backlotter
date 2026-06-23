import { Navigate, Outlet } from "react-router";
import { useAuth } from "./AuthContext";

/**
 * Gate for admin-only routes. Composes with {@link RequireAuth}: nest it inside a
 * RequireAuth route so unauthenticated users are sent to /login first; this guard then
 * sends authenticated-but-non-admin users back to /app.
 */
export function RequireAdmin() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user?.is_admin) return <Navigate to="/app" replace />;
  return <Outlet />;
}

export default RequireAdmin;
