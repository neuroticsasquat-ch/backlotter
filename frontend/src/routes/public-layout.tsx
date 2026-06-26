import { Link, Outlet } from "react-router";
import { SITE_NAME } from "@/lib/seo";

/** Unauthenticated, server-rendered public shell: a minimal brand header + the routed page. */
export default function PublicLayout() {
  // UTC so the SSR (Cloudflare Workers) and client renders agree regardless of the
  // viewer's timezone — getFullYear() would risk a hydration mismatch near year boundaries.
  const year = new Date().getUTCFullYear();
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto max-w-4xl p-4">
          <Link to="/" className="font-semibold">
            {SITE_NAME}
          </Link>
        </div>
      </header>
      <Outlet />
      <footer className="border-t text-sm text-muted-foreground">
        <div className="mx-auto max-w-4xl p-4">
          © {year} {SITE_NAME}
        </div>
      </footer>
    </div>
  );
}
