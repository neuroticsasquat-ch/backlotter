import type { FilmSource } from "@/api/types";

/** Outbound links to the stories an event's summary was based on. */
export function SourceLinks({ sources }: { sources: FilmSource[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
      <span className="text-gray-400">Sources:</span>
      {sources.map((source, i) => (
        <a
          key={`${source.url}-${i}`}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          title={source.title}
          className="text-blue-600 underline"
        >
          {source.source}
        </a>
      ))}
    </div>
  );
}
