import { Link, Outlet } from "react-router";

/** Unauthenticated, server-rendered public shell: a minimal brand header + the routed page. */
export default function PublicLayout() {
  const year = new Date().getUTCFullYear();
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto max-w-4xl p-4">
          <Link to="/" className="font-semibold">
            BackLotter
          </Link>
        </div>
      </header>
      <Outlet />
      <footer>
        <div className="mx-auto max-w-4xl p-4">© {year} BackLotter</div>
      </footer>
    </div>
  );
}
