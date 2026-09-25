import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  route("robots.txt", "routes/robots.ts"),
  route("sitemap.xml", "routes/sitemap.ts"),
  // Retired by EF-14; the redirect is the whole route module. See it for why it sits out here
  // rather than under `RequireAuth` with the page it replaced.
  route("me/watchlist", "routes/watchlist-redirect.ts"),

  layout("routes/public-layout.tsx", [
    index("routes/feed.tsx"),
    route("feed", "routes/all-updates.tsx"),
    route("calendar", "routes/calendar.tsx"),
    route("film/:ref", "routes/film.tsx"),
    route("person/:ref", "routes/person.tsx"),
    // "Studio" and "Franchise" in the URL as on screen (EF-19); the payloads and the follow
    // graph keep saying `company` and `franchise`, and the backend keeps saying `collection`.
    route("studio/:ref", "routes/studio.tsx"),
    route("franchise/:ref", "routes/franchise.tsx"),
    route("terms", "routes/terms.tsx"),
    route("privacy", "routes/privacy.tsx"),
  ]),

  layout("routes/spa-layout.tsx", [
    route("login", "pages/Login.tsx"),
    route("signup", "pages/Signup.tsx"),
    route("forgot", "pages/Forgot.tsx"),
    route("reset", "pages/Reset.tsx"),
    route("verify", "pages/Verify.tsx"),
    // Unauthenticated like `verify`: the confirmation link lands in the *new* address's inbox,
    // which by definition cannot sign in to the account yet (NEU-1341).
    route("email-change", "pages/EmailChange.tsx"),
    layout("components/RequireAuth.tsx", [
      // Signed-in but deliberately *not* under `RequireEntitled`: the page renders its own
      // locked state (D-41), because an account sent here by signup needs to be told the
      // onboarding is not open to it, not that its follows page is.
      route("welcome", "pages/Welcome.tsx"),
      // Same reasoning: the account basics on this page (email, password, verification) belong
      // to every signed-in account, and only its delivery block is subscriber functionality —
      // the page renders the locked panel in that block's place (NEU-1382, D-41).
      route("me/settings", "pages/Settings.tsx"),
      // The account pages sit behind entitlement as well as sign-in (D-41). The gate renders
      // the locked panel instead of redirecting, so an ungranted account is told what it is
      // missing rather than bounced.
      layout("components/follow/RequireEntitled.tsx", [route("me/follows", "pages/MyFollows.tsx")]),
      layout("components/RequireAdmin.tsx", [
        layout("components/layout/AdminLayout.tsx", [
          route("admin/ingest", "pages/AdminIngest.tsx"),
          route("admin/sources", "pages/AdminSources.tsx"),
          route("admin/users", "pages/AdminUsers.tsx"),
          route("admin/resolution", "pages/AdminResolution.tsx"),
          route("admin/invites", "pages/AdminInvites.tsx"),
          route("admin/digest", "pages/AdminDigest.tsx"),
        ]),
      ]),
    ]),
  ]),
] satisfies RouteConfig;
