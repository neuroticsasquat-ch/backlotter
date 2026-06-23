import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  route("robots.txt", "routes/robots.ts"),
  route("sitemap.xml", "routes/sitemap.ts"),

  layout("routes/public-layout.tsx", [
    route("preview", "routes/preview.tsx"),
    route("film/:slug", "routes/film.tsx"),
  ]),

  layout("routes/spa-layout.tsx", [
    route("login", "pages/Login.tsx"),
    route("signup", "pages/Signup.tsx"),
    layout("components/RequireAuth.tsx", [
      layout("components/AppLayout.tsx", [
        index("pages/Home.tsx"),
        layout("components/RequireAdmin.tsx", [route("admin/ingest", "pages/AdminIngest.tsx")]),
      ]),
    ]),
  ]),
] satisfies RouteConfig;
