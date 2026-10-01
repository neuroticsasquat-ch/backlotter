import type { FeedDayItem, FilmEvent } from "@/api/types";
import { UPDATE_TYPE_LABELS } from "@/components/film/labels";
import { dayKey, formatDayHeading } from "@/lib/format";

export interface FeedDayGroup {
  /** UTC "YYYY-MM-DD" — a stable React key for the day section. */
  dayKey: string;
  /** Human heading, e.g. "Monday, June 23, 2026". */
  heading: string;
  items: FeedDayItem[];
}

/**
 * Bucket a backend-ordered grouped feed (`day DESC`, then significance, then natural title) into
 * per-day sections. Each item is already one (film, day) row carrying a "YYYY-MM-DD" `day`, so we
 * bucket on that string directly. Preserving the backend order means groups come out
 * newest-day-first with a deterministic within-day order — no sorting, no `Date.now()`, so SSR and
 * client output match.
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

export interface FeedDaySplit {
  /** Items a news outlet reported — these lead the day. */
  newsBacked: FeedDayItem[];
  /** Items only TMDB has. */
  tmdbOnly: FeedDayItem[];
}

/**
 * Natural English sort key for a film title: strips leading "A ", "An ", "The "
 * (case-insensitive) before comparing.
 */
function naturalSortKey(title: string): string {
  return title.replace(/^(a|an|the)\s+/i, "").toLowerCase();
}

/**
 * Partition one day's items into the news-backed and TMDB-only sections the feed renders, in that
 * order. Keys off the backend's `news_backed` flag (`EXISTS(event_story)`), never `provenance`: an
 * event born on TMDB that a trade later covers is news-backed from then on, and must move section
 * without moving day.
 *
 * Within each bucket items are sorted by natural English title order (case-insensitive, ignoring
 * leading "A", "An", "The"), so the feed reads predictably regardless of the backend's ordering.
 */
export function splitByNewsBacked(items: FeedDayItem[]): FeedDaySplit {
  const sorted = [...items].sort((a, b) => {
    const cmp = naturalSortKey(a.film_title).localeCompare(naturalSortKey(b.film_title));
    return cmp !== 0 ? cmp : a.film_title.localeCompare(b.film_title);
  });
  const newsBacked: FeedDayItem[] = [];
  const tmdbOnly: FeedDayItem[] = [];
  for (const item of sorted) {
    (item.news_backed ? newsBacked : tmdbOnly).push(item);
  }
  return { newsBacked, tmdbOnly };
}

/**
 * The update types a grouped section is laid out by, most significant first (NR-3). A
 * hand-written list rather than a derivation from the backend's arc ranking (`_EVENT_STAGE`):
 * Crew, Studios and Franchise tie there, and their order is a product choice (people before
 * organisations); `canceled` ranks highest there, yet a reader looks for a cancellation where a
 * film's status lives. Other updates trails, and takes any type the map below does not know.
 */
export const UPDATE_TYPES = [
  "now_available",
  "trailer",
  "release_date",
  "production_status",
  "cast",
  "crew",
  "studios",
  "franchise",
  "other",
] as const;

export type UpdateType = (typeof UPDATE_TYPES)[number];

/** Which update type each known `event_type` files under. A `Map`, so an `event_type` that
 *  happens to name an `Object.prototype` member falls through to Other updates like any other. */
const UPDATE_TYPE_OF_EVENT = new Map<string, UpdateType>([
  ["now_available", "now_available"],
  ["trailer", "trailer"],
  ["release_date", "release_date"],
  ["production_start", "production_status"],
  ["production_wrap", "production_status"],
  ["canceled", "production_status"],
  ["casting", "cast"],
  ["cast_removed", "cast"],
  ["crew_attached", "crew"],
  ["crew_removed", "crew"],
  ["company_attached", "studios"],
  ["company_removed", "studios"],
  ["collection_attached", "franchise"],
  ["collection_removed", "franchise"],
]);

function updateTypeOf(eventType: string): UpdateType {
  return UPDATE_TYPE_OF_EVENT.get(eventType) ?? "other";
}

export interface UpdateTypeRow {
  /** The whole feed row, so the film's full header renders under every heading it appears in. */
  item: FeedDayItem;
  /** Only this heading's events, in the backend's order. Empty for a no-events fallback row. */
  events: FilmEvent[];
}

export interface UpdateTypeGroup {
  key: UpdateType;
  label: string;
  rows: UpdateTypeRow[];
}

/**
 * Lay a day's feed rows out by update type: headings in `UPDATE_TYPES` order, each holding one
 * row per film that changed that way, each row holding only that heading's events (NR-3, NR-4).
 * A film with changes of two types sits under both. Headings with nothing under them are left
 * out, and films keep the order they came in, so the caller's natural-title sort survives.
 *
 * Section-agnostic on purpose (NR-7): it never reads `news_backed` and leaves events, sources
 * included, untouched — `FeedDayGroups` alone decides which section is grouped. A row that
 * arrives with no events (the NEU-1212 fallback) is filed under each of its `event_types`.
 */
export function groupByUpdateType(items: FeedDayItem[]): UpdateTypeGroup[] {
  // Keyed by the row object, not `film_ref`: a caller passing both of a day's sections would
  // hand in the same film twice, and those are two rows, not one.
  const byType = new Map<UpdateType, Map<FeedDayItem, UpdateTypeRow>>();
  const rowFor = (type: UpdateType, item: FeedDayItem): UpdateTypeRow => {
    let rows = byType.get(type);
    if (!rows) byType.set(type, (rows = new Map()));
    let row = rows.get(item);
    if (!row) rows.set(item, (row = { item, events: [] }));
    return row;
  };
  for (const item of items) {
    if (item.events.length > 0) {
      for (const event of item.events)
        rowFor(updateTypeOf(event.event_type), item).events.push(event);
    } else {
      for (const eventType of item.event_types) rowFor(updateTypeOf(eventType), item);
    }
  }
  return UPDATE_TYPES.flatMap((key) => {
    const rows = byType.get(key);
    return rows ? [{ key, label: UPDATE_TYPE_LABELS[key], rows: [...rows.values()] }] : [];
  });
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

/** How many posters the day's strip renders at most. The desktop column clips to the event
 *  list's height, so the true count is whatever fits — this is only a ceiling that stops a
 *  backfill day (ADR-0016 notes those run to 70+ rows) from loading dozens of images to clip
 *  all but a few. Eight stacked posters cover roughly fourteen feed rows. */
export const MAX_DAY_POSTERS = 8;

/**
 * The films whose posters lead a feed day, news-backed first and at most `limit` of them.
 *
 * Ordered through `splitByNewsBacked` rather than by taking the backend's order directly, so the
 * strip agrees with the sections the reader sees below it. Backend order within a day is by
 * significance, not by section, so the raw first item is simply the film with the day's most
 * significant beat — which is a TMDB-only one often enough to read as a rule.
 *
 * Films without a poster are dropped rather than held as blanks. A pure function of its input —
 * no `Date.now()` — so SSR and client output match, same contract as `groupByDay`.
 */
export function dayPosterLeads(items: FeedDayItem[], limit = MAX_DAY_POSTERS): FeedDayItem[] {
  const { newsBacked, tmdbOnly } = splitByNewsBacked(items.filter((item) => item.poster_path));
  const seen = new Set<string>();
  return [...newsBacked, ...tmdbOnly]
    .filter((item) => {
      if (seen.has(item.film_ref)) return false;
      seen.add(item.film_ref);
      return true;
    })
    .slice(0, limit);
}
