import { useLocation } from "react-router";

/**
 * What a public route's ErrorBoundary renders when the API shed its loader's request under load
 * (NEU-2273, `lib/overload.ts`). Not an error to the visitor: the API answers again within
 * seconds, so the page says so and offers the same address again.
 *
 * "Try again" is a plain anchor, not a `<Link>`: it works before hydration, and a full load is
 * what re-runs the SSR loader that was shed.
 */
export function BusyPage() {
  const { pathname, search } = useLocation();
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Busy right now</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        We&apos;re handling a lot of requests. Try again in a few seconds.
      </p>
      <a
        href={`${pathname}${search}`}
        className="mt-6 inline-block text-sm text-blue-600 underline"
      >
        Try again
      </a>
    </main>
  );
}
