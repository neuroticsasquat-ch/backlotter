import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import * as Sentry from "@sentry/react";
import "./styles/globals.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="icon" href="/favicon.ico" sizes="48x48" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, interactive-widget=resizes-content"
        />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  let title = "Something went wrong";
  let detail = "Please refresh the page.";
  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`;
    detail = error.status === 404 ? "Page not found." : detail;
    // Report unexpected server responses, but not ordinary client errors (e.g. 404).
    if (error.status >= 500) {
      Sentry.captureException(error);
    }
  } else {
    // Unexpected runtime error from a loader or render — report it. This is the
    // app-wide catch-all (public + SPA routes); the SPA subtree has its own boundary.
    Sentry.captureException(error);
  }
  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm">{detail}</p>
    </main>
  );
}
