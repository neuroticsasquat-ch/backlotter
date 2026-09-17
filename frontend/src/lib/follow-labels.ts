import type { FollowEntityType } from "@/api/types";

/**
 * Names for the things a user follows, remembered in this browser.
 *
 * `GET /me/follows` answers with `(entity_type, entity_id, source, created_at)` and nothing
 * else (NEU-1349): the follow graph stores TMDB ids, and the catalog has no by-id lookup for
 * people, companies or collections — `/people/search` and friends match on name, which is the
 * thing we are trying to find. So a follows page built strictly on that contract can only
 * label its rows "Person 525".
 *
 * This is the stopgap: every place the app *does* know a name beside an id — a follow button
 * on the film page, a result picked out of the add-follow search box — writes the pair here on
 * its way past, and the follows page reads it back. A row it has never seen falls back to the
 * entity type plus a TMDB link, which is honest about what we know rather than pretending.
 *
 * The real fix is `GET /me/follows` returning the name, which is a backend change and a
 * separate ticket. Until then, expect this to be empty on a second device and after a user
 * clears site data, and to be populated for any follow made from this app.
 */
export interface FollowLabel {
  /** The entity's own name — "Christopher Nolan", not "Follow Christopher Nolan". */
  label: string;
  /** TMDB `profile_path` / `logo_path` / `poster_path`, when the source knew one. */
  imagePath: string | null;
}

const STORAGE_KEY = "backlotter.follow-labels.v1";

/**
 * Oldest entries are dropped past this. A cap is needed because nothing ever deletes from
 * here — unfollowing does not, deliberately, since re-following the same person should not
 * cost them their name back. 500 is far past any plausible follow count while staying small
 * enough that the whole record parses in well under a frame.
 */
const MAX_ENTRIES = 500;

type LabelRecord = Record<string, FollowLabel>;

const entityKey = (entityType: FollowEntityType, entityId: string) => `${entityType}:${entityId}`;

/**
 * The in-memory mirror, and the reason reads are synchronous. It is also what makes a label
 * learned this session visible to a component that renders before the write has been read
 * back, and what keeps a page full of rows from parsing the same JSON once per row.
 *
 * `null` means "not loaded yet", which is distinct from "loaded and empty".
 */
let cache: LabelRecord | null = null;

/** Every storage access is wrapped: a private window, blocked site data or a full quota all
 *  throw here, and none of them is a reason for the follows page to fail to render. */
function read(): LabelRecord {
  if (cache !== null) return cache;
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    cache = typeof parsed === "object" && parsed !== null ? (parsed as LabelRecord) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function write(next: LabelRecord): void {
  cache = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The mirror above still holds the label for this session, which is the case that
    // matters: the user has just followed something and is about to look at the list.
  }
}

/** The name for a followed entity, or null if this browser has never seen one. */
export function lookupFollowLabel(
  entityType: FollowEntityType,
  entityId: string,
): FollowLabel | null {
  return read()[entityKey(entityType, entityId)] ?? null;
}

/**
 * Remember a name. Called wherever the app learns one: the film page's follow buttons and the
 * add-follow search box both pass through here.
 *
 * Re-inserting an existing key moves it to the end, so the eviction below drops what has been
 * untouched the longest rather than what was first learned — a person followed at signup and
 * seen on the list every day since should outlive a one-off.
 */
export function rememberFollowLabel(
  entityType: FollowEntityType,
  entityId: string,
  label: string,
  imagePath: string | null = null,
): void {
  const key = entityKey(entityType, entityId);
  const next: LabelRecord = { ...read() };
  // Deleted before re-inserting, rather than overwritten in place: assigning to an existing
  // key keeps its original position, and the eviction below reads insertion order as recency.
  delete next[key];
  next[key] = { label, imagePath };
  const keys = Object.keys(next);
  if (keys.length > MAX_ENTRIES) {
    for (const stale of keys.slice(0, keys.length - MAX_ENTRIES)) delete next[stale];
  }
  write(next);
}

/** Drops the in-memory mirror so the next read comes from storage. For tests. */
export function resetFollowLabelCache(): void {
  cache = null;
}
