/** Same-origin path the browser SDK posts envelopes to (the Sentry `tunnel` target,
 *  set in entry.client.tsx). Routing through our own origin keeps ad blockers from
 *  dropping the request to `ingest.sentry.io`. The Worker proxies it on (workers/app.ts). */
export const SENTRY_TUNNEL_PATH = "/monitoring";

/**
 * Validate a tunneled Sentry envelope against our own DSN and return the upstream ingest
 * URL to forward it to, or `null` if it doesn't target our project — so the tunnel can't
 * be abused as an open relay.
 *
 * `envelopeHeader` is the first line of the envelope: a JSON object whose `dsn` field
 * names the intended destination. `ourDsn` is the Worker's `SENTRY_DSN`
 * (`https://<key>@<host>/<projectId>`).
 */
export function sentryTunnelUpstream(ourDsn: string, envelopeHeader: string): string | null {
  if (!ourDsn) return null;
  let ours: URL;
  let target: URL;
  try {
    ours = new URL(ourDsn);
    const header = JSON.parse(envelopeHeader) as { dsn?: string };
    if (!header.dsn) return null;
    target = new URL(header.dsn);
  } catch {
    return null;
  }
  const projectId = ours.pathname.replace(/^\//, "");
  const targetProjectId = target.pathname.replace(/^\//, "");
  if (target.host !== ours.host || targetProjectId !== projectId) return null;
  return `https://${ours.host}/api/${projectId}/envelope/`;
}
