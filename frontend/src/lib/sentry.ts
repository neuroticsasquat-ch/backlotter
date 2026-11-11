// Set by vite.config.ts on a build that knows its commit (NEU-1594); undefined in dev, in
// tests, and on a build without one.
declare const __GIT_SHA__: string | undefined;

/** The Sentry/Bugsink release: the git SHA the source maps were uploaded under. Read by both
 *  the browser (`entry.client.tsx`) and the Worker (`workers/app.ts`) init, so the two report
 *  the same release. Undefined rather than a placeholder when the build had none, so events
 *  carry no release instead of a wrong one. */
export const sentryRelease: string | undefined =
  typeof __GIT_SHA__ === "string" ? __GIT_SHA__ : undefined;

/** Clients whose browser errors are artefacts of the client, not of our code. Lightpanda, a
 *  headless crawler, fails to parse `/me`'s valid JSON 401 body and reports the rejection as
 *  unhandled although `api/client.ts` catches it: ~100 false events a day, each with a replay
 *  (NEU-2270, Bugsink `UPCOMING-MOVIES-FRONTEND-3`). */
const SKIPPED_USER_AGENTS = /Lightpanda/i;

/** Whether `entry.client.tsx` should start the browser SDK for this user agent. Skipping the
 *  init, rather than filtering in `beforeSend`, also stops the client's traces and replays. */
export function shouldInitBrowserSentry(userAgent: string): boolean {
  return !SKIPPED_USER_AGENTS.test(userAgent);
}
