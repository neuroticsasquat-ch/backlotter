import type { FeedDayItem } from "@/api/types";
import { formatDayHeading } from "@/lib/format";

export interface FeedDayGroup {
  /** UTC "YYYY-MM-DD" — a stable React key for the day section. */
  dayKey: string;
  /** Human heading, e.g. "Monday, June 23, 2026". */
  heading: string;
  items: FeedDayItem[];
}

/**
 * Bucket a backend-ordered grouped feed (`day DESC, last_created_at DESC, slug ASC`) into per-day
 * sections. Each item is already one (film, day) row carrying a "YYYY-MM-DD" `day`, so we bucket on
 * that string directly. Preserving the backend order means groups come out newest-day-first with a
 * deterministic within-day order — no sorting, no `Date.now()`, so SSR and client output match.
 */
export function groupByDay(items: FeedDayItem[]): FeedDayGroup[] {
  const groups: FeedDayGroup[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.dayKey === item.day) {
      last.items.push(item);
    } else {
      groups.push({ dayKey: item.day, heading: formatDayHeading(item.day), items: [item] });
    }
  }
  return groups;
}
