import { marked } from "marked";

/**
 * Convert a Markdown string to an HTML string.
 *
 * Used for our own static, PR-reviewed legal content only — never untrusted input —
 * so no sanitization step is needed. `marked` is pure string→string and runs on the
 * Cloudflare Workers edge runtime (no DOM required). `async: false` guarantees a
 * synchronous string return so callers can run it at module scope.
 */
export function renderMarkdown(md: string): string {
  return marked.parse(md, { async: false });
}
