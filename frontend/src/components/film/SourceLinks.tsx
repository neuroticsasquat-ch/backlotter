import type { FilmSource } from "@/api/types";

/** Outbound links to the stories an event's summary was based on, shown as
 *  clearly-clickable chips — each opens the original article in a new tab. */
export function SourceLinks({ sources }: { sources: FilmSource[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">Sources</span>
      {sources.map((source, i) => (
        <a
          key={`${source.url}-${i}`}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          title={source.title}
          className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-foreground transition-colors hover:border-blue-500 hover:bg-blue-500/10 hover:text-blue-400"
        >
          {source.source}
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M7 17 17 7" />
            <path d="M9 7h8v8" />
          </svg>
        </a>
      ))}
    </div>
  );
}
