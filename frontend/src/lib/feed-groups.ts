import type { FeedItem } from "@/api/types";
import { dayKey, formatDayHeading } from "@/lib/format";

export interface DayGroup {
  /** UTC "YYYY-MM-DD" — a stable React key for the day section. */
  dayKey: string;
  /** Human heading, e.g. "Monday, June 23, 2026". */
  heading: string;
  items: FeedItem[];
}

/**
 * Bucket a `created_at`-descending feed into per-UTC-day groups. The input order is preserved,
 * so groups come out newest-day-first and items stay newest-first within a day — no sorting and
 * no `Date.now()`, keeping SSR and client output identical.
 */
export function groupByDay(items: FeedItem[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const item of items) {
    const key = dayKey(item.created_at);
    const last = groups[groups.length - 1];
    if (last && last.dayKey === key) {
      last.items.push(item);
    } else {
      groups.push({ dayKey: key, heading: formatDayHeading(item.created_at), items: [item] });
    }
  }
  return groups;
}
