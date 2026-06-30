import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  route("robots.txt", "routes/robots.ts"),
  route("sitemap.xml", "routes/sitemap.ts"),

  layout("routes/public-layout.tsx", [
    index("routes/feed.tsx"),
    route("calendar", "routes/calendar.tsx"),
    route("film/:slug", "routes/film.tsx"),
    route("terms", "routes/terms.tsx"),
    route("privacy", "routes/privacy.tsx"),
  ]),

  layout("routes/spa-layout.tsx", [
    route("login", "pages/Login.tsx"),
    route("signup", "pages/Signup.tsx"),
    layout("components/RequireAuth.tsx", [
      layout("components/RequireAdmin.tsx", [route("admin/ingest", "pages/AdminIngest.tsx")]),
    ]),
  ]),
] satisfies RouteConfig;
