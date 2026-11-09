// Set by vite.config.ts on a build that knows its commit (NEU-1594); undefined in dev, in
// tests, and on a build without one.
declare const __GIT_SHA__: string | undefined;

/** The Sentry/Bugsink release: the git SHA the source maps were uploaded under. Read by both
 *  the browser (`entry.client.tsx`) and the Worker (`workers/app.ts`) init, so the two report
 *  the same release. Undefined rather than a placeholder when the build had none, so events
 *  carry no release instead of a wrong one. */
export const sentryRelease: string | undefined =
  typeof __GIT_SHA__ === "string" ? __GIT_SHA__ : undefined;
