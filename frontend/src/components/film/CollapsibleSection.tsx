import type { ReactNode } from "react";

/** A disclosure section with a clear expandable affordance: a chevron that rotates when
 *  open, a hover highlight, and a count. Uses native <details>/<summary> so it works
 *  without JS (SSR-safe). Delimited by a top border to keep stacked sections tight.
 *  Closed by default unless `defaultOpen`; `railed` (default) hangs the content off a left
 *  rail — pass `railed={false}` when the children already supply their own rails. */
export function CollapsibleSection({
  title,
  count,
  defaultOpen = false,
  railed = true,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  railed?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="group border-t border-border" {...(defaultOpen ? { open: true } : {})}>
      <summary className="-mx-2 flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-3 text-foreground transition-colors hover:bg-muted/40 hover:text-blue-400 [&::-webkit-details-marker]:hidden">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-90"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 6 15 12 9 18" />
        </svg>
        <h2 className="text-lg font-semibold">{title}</h2>
        {count != null && (
          <span className="text-sm font-normal text-muted-foreground">({count})</span>
        )}
      </summary>

      {/* Railed: the list hangs off a single left rail (heading stays above it), mirroring
          the per-day movie list on the home feed. Unrailed: children supply their own. */}
      <div className={railed ? "mb-4 ml-1 border-l-2 border-border pl-3" : "pb-4"}>{children}</div>
    </details>
  );
}
