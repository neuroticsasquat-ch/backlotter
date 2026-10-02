import type { FeedDayItem, FeedVia, FilmEvent } from "@/api/types";
import {
  ENTITY_UPDATE_TYPE_LABELS,
  FOLLOW_BLOCK_LABELS,
  UPDATE_TYPE_LABELS,
} from "@/components/film/labels";
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

/** Natural title order, then the raw title, so two titles equal under the natural key still
 *  compare deterministically. */
function compareFilmTitles(a: FeedDayItem, b: FeedDayItem): number {
  const cmp = naturalSortKey(a.film_title).localeCompare(naturalSortKey(b.film_title));
  return cmp !== 0 ? cmp : a.film_title.localeCompare(b.film_title);
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
  const sorted = [...items].sort(compareFilmTitles);
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

/**
 * The update types an entity block's Not yet reported is laid out by (FB-4): the attachment
 * stream an entity follow delivers, joins before leaves. `canceled` is neither — ADR-0019
 * rejected modelling a cancellation as a detachment — so it is its own heading, last before
 * Other updates. A second literal beside `UPDATE_TYPES`, never merged with it: `casting` is Cast
 * under Films and Attached under People.
 */
export const ENTITY_UPDATE_TYPES = ["attached", "detached", "canceled", "other"] as const;

export type EntityUpdateType = (typeof ENTITY_UPDATE_TYPES)[number];

const ENTITY_UPDATE_TYPE_OF_EVENT = new Map<string, EntityUpdateType>([
  ["casting", "attached"],
  ["crew_attached", "attached"],
  ["company_attached", "attached"],
  ["collection_attached", "attached"],
  ["cast_removed", "detached"],
  ["crew_removed", "detached"],
  ["company_removed", "detached"],
  ["collection_removed", "detached"],
  ["canceled", "canceled"],
]);

/** One way of laying a section out by update type: its headings in render order, which heading
 *  each known `event_type` files under, the heading for any type it does not know, and what each
 *  heading reads. */
export interface UpdateTypeMap<K extends string> {
  order: readonly K[];
  byEventType: ReadonlyMap<string, K>;
  fallback: K;
  labels: Record<K, string>;
}

/** The Films block's layout, and the global feed's (NR-3). */
export const FILM_UPDATE_TYPE_MAP: UpdateTypeMap<UpdateType> = {
  order: UPDATE_TYPES,
  byEventType: UPDATE_TYPE_OF_EVENT,
  fallback: "other",
  labels: UPDATE_TYPE_LABELS,
};

/** The People, Studios and Franchises blocks' layout (FB-4). */
export const ENTITY_UPDATE_TYPE_MAP: UpdateTypeMap<EntityUpdateType> = {
  order: ENTITY_UPDATE_TYPES,
  byEventType: ENTITY_UPDATE_TYPE_OF_EVENT,
  fallback: "other",
  labels: ENTITY_UPDATE_TYPE_LABELS,
};

export interface UpdateTypeRow {
  /** The whole feed row, so the film's full header renders under every heading it appears in. */
  item: FeedDayItem;
  /** Only this heading's events, in the backend's order. Empty for a no-events fallback row. */
  events: FilmEvent[];
}

export interface UpdateTypeGroup<K extends string = UpdateType> {
  key: K;
  label: string;
  rows: UpdateTypeRow[];
}

/**
 * Lay a day's feed rows out by update type: headings in the map's order, each holding one row
 * per film that changed that way, each row holding only that heading's events (NR-3, NR-4).
 * A film with changes of two types sits under both. Headings with nothing under them are left
 * out, and films keep the order they came in, so the caller's natural-title sort survives.
 *
 * Section-agnostic on purpose (NR-7): it never reads `news_backed` and leaves events, sources
 * included, untouched — `FeedDayGroups` alone decides which section is grouped. Block-agnostic
 * too (FB-4): the caller picks the map, and without one gets the Films block's, which is what
 * the global feed has always laid out. A row that arrives with no events (the NEU-1212
 * fallback) is filed under each of its `event_types`.
 */
export function groupByUpdateType(items: FeedDayItem[]): UpdateTypeGroup[];
export function groupByUpdateType<K extends string>(
  items: FeedDayItem[],
  map: UpdateTypeMap<K>,
): UpdateTypeGroup<K>[];
export function groupByUpdateType(
  items: FeedDayItem[],
  map: UpdateTypeMap<string> = FILM_UPDATE_TYPE_MAP,
): UpdateTypeGroup<string>[] {
  const typeOf = (eventType: string) => map.byEventType.get(eventType) ?? map.fallback;
  // Keyed by the row object, not `film_ref`: a caller passing both of a day's sections would
  // hand in the same film twice, and those are two rows, not one.
  const byType = new Map<string, Map<FeedDayItem, UpdateTypeRow>>();
  const rowFor = (type: string, item: FeedDayItem): UpdateTypeRow => {
    let rows = byType.get(type);
    if (!rows) byType.set(type, (rows = new Map()));
    let row = rows.get(item);
    if (!row) rows.set(item, (row = { item, events: [] }));
    return row;
  };
  for (const item of items) {
    if (item.events.length > 0) {
      for (const event of item.events) rowFor(typeOf(event.event_type), item).events.push(event);
    } else {
      for (const eventType of item.event_types) rowFor(typeOf(eventType), item);
    }
  }
  return map.order.flatMap((key) => {
    const rows = byType.get(key);
    return rows ? [{ key, label: map.labels[key], rows: [...rows.values()] }] : [];
  });
}

/** The follow blocks a timeline day is laid out in, in their fixed order (FB-1). */
export const FOLLOW_BLOCKS = ["films", "people", "studios", "franchises"] as const;

export type FollowBlock = (typeof FOLLOW_BLOCKS)[number];

const FOLLOW_BLOCK_OF_ENTITY_TYPE: Record<FeedVia["entity_type"], FollowBlock> = {
  person: "people",
  company: "studios",
  franchise: "franchises",
};

export interface FollowBlockGroup {
  key: FollowBlock;
  label: string;
  items: FeedDayItem[];
}

/**
 * Partition one day's timeline rows into follow blocks, in `FOLLOW_BLOCKS` order, keyed on the
 * row's reach (`via?.entity_type`). A row with `via` null — or with no `via` at all, from a
 * backend older than the field (FB-9) — is a title row and lands in Films, so against that
 * backend every row does and the day reads as it always has. Blocks with no rows are left out
 * (FB-1), and rows keep the order they came in.
 */
export function groupByFollowBlock(items: FeedDayItem[]): FollowBlockGroup[] {
  const byBlock = new Map<FollowBlock, FeedDayItem[]>();
  for (const item of items) {
    const key = item.via ? FOLLOW_BLOCK_OF_ENTITY_TYPE[item.via.entity_type] : "films";
    // A reach this frontend has no block for (a newer backend's) is dropped, never filed as a
    // film row: it did not reach the reader through a title follow.
    if (!key) continue;
    let blockItems = byBlock.get(key);
    if (!blockItems) byBlock.set(key, (blockItems = []));
    blockItems.push(item);
  }
  return FOLLOW_BLOCKS.flatMap((key) => {
    const blockItems = byBlock.get(key);
    return blockItems ? [{ key, label: FOLLOW_BLOCK_LABELS[key], items: blockItems }] : [];
  });
}

/** A row's reach as text: `title` for a title row, `${entity_type}:${entity_id}` otherwise. */
function reachKey(via: FeedVia | null | undefined): string {
  return via ? `${via.entity_type}:${via.entity_id}` : "title";
}

/**
 * A timeline row's React key, `${reach}:${film_ref}` (FB-9). The film alone no longer
 * identifies a row: a film-day reached by a title follow and by two entity follows is three rows
 * (FB-5).
 */
export function rowKey(item: FeedDayItem): string {
  return `${reachKey(item.via)}:${item.film_ref}`;
}

export interface EntityLine {
  /** The row the card came in on, for the film it is about: the line's headline link. */
  item: FeedDayItem;
  event: FilmEvent;
}

export interface EntityRow {
  /** `${entity_type}:${entity_id}` — the entity's reach, a stable React key. */
  key: string;
  via: FeedVia;
  lines: EntityLine[];
}

/** People sort by name as written, casefolded — "The" is not how a person's name starts.
 *  Studios and franchises sort as titles do (FB-6). */
function entitySortKey(via: FeedVia): string {
  const name = via.name ?? "";
  return via.entity_type === "person" ? name.toLowerCase() : naturalSortKey(name);
}

function compareEntities(a: FeedVia, b: FeedVia): number {
  // An entity the catalog cannot name (FB-10) has nothing to sort by, so it trails.
  if ((a.name === null) !== (b.name === null)) return a.name === null ? 1 : -1;
  const cmp = entitySortKey(a).localeCompare(entitySortKey(b));
  return cmp !== 0 ? cmp : a.entity_id.localeCompare(b.entity_id);
}

/**
 * Merge a section's entity-reach rows into one row per `(entity_type, entity_id)` (FB-3): the
 * backend ships one row per (entity, film), and the reader sees the entity once with a line per
 * card, each tagged with its film. Rows sort by entity name (`compareEntities`), ties on
 * `entity_id`; lines by the film's natural title, then the backend's event order (FB-6).
 *
 * Takes one day's section as feed rows, or one update type's rows of it as `groupByUpdateType`
 * hands them back — those carry only their heading's events, so an entity row under Attached
 * holds only its attachments (NR-4, per entity). Never reads `day` or `news_backed`. Title rows
 * (no `via`) are not entity rows and are skipped, and so is an entity left with no lines: the
 * backend that ships `via` always ships events, so only a no-events fallback row has none.
 */
export function groupByEntity(rows: (FeedDayItem | UpdateTypeRow)[]): EntityRow[] {
  const byEntity = new Map<string, { via: FeedVia; rows: UpdateTypeRow[] }>();
  for (const input of rows) {
    const row = "item" in input ? input : { item: input, events: input.events };
    const reach = row.item.via;
    if (!reach) continue;
    const key = reachKey(reach);
    let entity = byEntity.get(key);
    if (!entity) byEntity.set(key, (entity = { via: reach, rows: [] }));
    entity.rows.push(row);
  }
  return [...byEntity]
    .map(([key, entity]) => ({
      key,
      via: entity.via,
      // A stable sort, so a film's events keep the backend's order among themselves.
      lines: [...entity.rows]
        .sort((a, b) => compareFilmTitles(a.item, b.item))
        .flatMap(({ item, events }) => events.map((event) => ({ item, event }))),
    }))
    .filter((entity) => entity.lines.length > 0)
    .sort((a, b) => compareEntities(a.via, b.via));
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
