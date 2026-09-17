import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  route("robots.txt", "routes/robots.ts"),
  route("sitemap.xml", "routes/sitemap.ts"),

  layout("routes/public-layout.tsx", [
    index("routes/feed.tsx"),
    route("feed", "routes/all-updates.tsx"),
    route("calendar", "routes/calendar.tsx"),
    route("film/:ref", "routes/film.tsx"),
    route("terms", "routes/terms.tsx"),
    route("privacy", "routes/privacy.tsx"),
  ]),

  layout("routes/spa-layout.tsx", [
    route("login", "pages/Login.tsx"),
    route("signup", "pages/Signup.tsx"),
    route("forgot", "pages/Forgot.tsx"),
    route("reset", "pages/Reset.tsx"),
    route("verify", "pages/Verify.tsx"),
    layout("components/RequireAuth.tsx", [
      // Signed-in but deliberately *not* under `RequireEntitled`: the page renders its own
      // locked state (D-41), because an account sent here by signup needs to be told the
      // onboarding is not open to it, not that its follows page is.
      route("welcome", "pages/Welcome.tsx"),
      // The account pages sit behind entitlement as well as sign-in (D-41). The gate renders
      // the locked panel instead of redirecting, so an ungranted account is told what it is
      // missing rather than bounced.
      layout("components/follow/RequireEntitled.tsx", [
        route("me/follows", "pages/MyFollows.tsx"),
        route("me/watchlist", "pages/MyWatchlist.tsx"),
      ]),
      layout("components/RequireAdmin.tsx", [
        layout("components/layout/AdminLayout.tsx", [
          route("admin/ingest", "pages/AdminIngest.tsx"),
          route("admin/sources", "pages/AdminSources.tsx"),
          route("admin/users", "pages/AdminUsers.tsx"),
        ]),
      ]),
    ]),
  ]),
] satisfies RouteConfig;
