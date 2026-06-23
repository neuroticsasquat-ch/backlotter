import { Outlet } from "react-router";

/** Unauthenticated, server-rendered public shell. Real header/nav lands in M3/M4. */
export default function PublicLayout() {
  return (
    <div className="min-h-screen">
      <Outlet />
    </div>
  );
}
