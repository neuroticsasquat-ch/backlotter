import type { FeedDayItem, FilmEvent } from "@/api/types";
import { dayKey, formatDayHeading } from "@/lib/format";

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

export interface EventDayGroup {
  /** UTC "YYYY-MM-DD" — a stable React key for the day section. */
  dayKey: string;
  /** Human heading, e.g. "Monday, June 23, 2026". */
  heading: string;
  /** The day's events, newest-first. */
  events: FilmEvent[];
}

/**
 * Bucket a film's events into per-day sections, newest day first and newest event first within a
 * day. Input must be ascending by `created_at` (the order `GET /films/{slug}` returns); we reverse
 * a copy — deterministic, no `Date.now()`, so SSR and client output match — then bucket adjacent
 * events sharing a UTC day key derived from `created_at`.
 */
export function groupEventsByDay(events: FilmEvent[]): EventDayGroup[] {
  const groups: EventDayGroup[] = [];
  for (const event of [...events].reverse()) {
    const key = dayKey(event.created_at);
    const last = groups[groups.length - 1];
    if (last && last.dayKey === key) {
      last.events.push(event);
    } else {
      groups.push({ dayKey: key, heading: formatDayHeading(key), events: [event] });
    }
  }
  return groups;
}
