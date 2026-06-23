import { Link } from "react-router";
import type { FeedItem } from "@/api/types";
import { cn } from "@/lib/cn";
import { formatEventDate } from "@/lib/format";
import { eventTypeLabel } from "@/components/film/labels";
import { SourceLinks } from "@/components/film/SourceLinks";

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const known = confidence === "confirmed" || confidence === "rumored";
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs",
        confidence === "confirmed" && "bg-green-100 text-green-800",
        confidence === "rumored" && "bg-amber-100 text-amber-800",
        !known && "bg-gray-100 text-gray-700",
      )}
    >
      {confidence === "confirmed" ? "Confirmed" : confidence === "rumored" ? "Rumored" : confidence}
    </span>
  );
}

/** One feed item: the film (linked to its page), its beat, confidence, date, summary, sources. */
export function FeedItemCard({ item }: { item: FeedItem }) {
  return (
    <article className="rounded-lg border border-gray-200 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 font-semibold uppercase tracking-wide text-indigo-800">
          {eventTypeLabel(item.event_type)}
        </span>
        <ConfidenceBadge confidence={item.confidence} />
        <time dateTime={item.created_at} className="ml-auto text-gray-400">
          {formatEventDate(item.created_at)}
        </time>
      </div>
      <h3 className="mt-2 text-base font-semibold">
        <Link to={`/film/${item.film_slug}`} className="hover:underline">
          {item.film_title}
        </Link>
      </h3>
      <p className="mt-1 text-sm leading-relaxed">{item.summary}</p>
      <SourceLinks sources={item.sources} />
    </article>
  );
}
