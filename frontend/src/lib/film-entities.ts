import type {
  CastMember,
  CrewMember,
  FilmCollection,
  FilmCompany,
  FilmDetail,
  FollowEntityType,
} from "@/api/types";

/** One thing on the film page that can be followed: what the follow graph needs to key on
 *  (D-10), plus the name to put in the button's accessible label. */
export interface FollowTarget {
  entityType: FollowEntityType;
  entityId: string;
  /** The entity's own name — "Christopher Nolan", not "Follow Christopher Nolan". */
  label: string;
  /** TMDB image path for the entity, where the source that built this target had one. Carried
   *  so the optimistic row a follow writes has a face as well as a name, rather than flashing
   *  a placeholder until the refetch lands — `GET /me/follows` resolves both from the catalog
   *  (NEU-1396), so this only has to cover the moment before that answer arrives. The film
   *  page's builders below leave it undefined, which costs that moment an avatar and nothing
   *  else. */
  imagePath?: string | null;
}

/** Every target builder answers `null` for an entity the film payload cannot identify, and
 *  the page renders no button for a null target. That is the whole handling of the missing
 *  ids described on {@link FilmDetail.id}: one branch, in one place, per entity. */
function target(
  entityType: FollowEntityType,
  entityId: number | string | null | undefined,
  label: string,
): FollowTarget | null {
  if (entityId === null || entityId === undefined) return null;
  return { entityType, entityId: String(entityId), label };
}

export const personTarget = (person: CastMember | CrewMember): FollowTarget | null =>
  target("person", person.person_id, person.name);

/**
 * An entity page's URL for something we know the id and name of.
 *
 * The ref resolves on its **leading id**; everything after the first hyphen is decorative, so
 * this only has to be *stable*, not identical to the backend's. It is a rough `slugify`
 * — diacritics folded, everything non-alphanumeric run together into hyphens — and a name in a
 * script it cannot fold (Cyrillic, Han) falls through to the bare id, which is a valid ref. The
 * page redirects to the canonical form either way, so a link minted here is at worst one 301
 * slower, never wrong.
 *
 * One builder for all three kinds, because all three refs are the same `<tmdb_id>-<slug>`
 * scheme — the backend folded `person_ref`, `company_ref` and `collection_ref` into one
 * implementation in NEU-1428 for exactly that reason. The segment is the *on-screen* word, not
 * the payload's: `/studio/` and `/franchise/` for what the code calls `company` and
 * `franchise` (EF-19).
 */
function entityPath(segment: string, id: number | string, name: string): string {
  const stem = name
    .normalize("NFKD")
    // The combining marks NFKD just split off, so "Chloé" folds to "chloe" rather than
    // hyphenating at the accent.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return stem ? `/${segment}/${id}-${stem}` : `/${segment}/${id}`;
}

export const personPath = (id: number | string, name: string) => entityPath("person", id, name);

/** The studio page's URL for a `company` (EF-19 calls it a Studio on screen). */
export const studioPath = (id: number | string, name: string) => entityPath("studio", id, name);

/** The franchise page's URL for a `franchise` — TMDB's "collection", the backend's
 *  `/collections/{ref}`, and a Franchise everywhere the reader can see it. */
export const franchisePath = (id: number | string, name: string) =>
  entityPath("franchise", id, name);

export const companyTarget = (company: FilmCompany): FollowTarget | null =>
  target("company", company.id, company.name);

export const collectionTarget = (collection: FilmCollection | null): FollowTarget | null =>
  collection ? target("franchise", collection.id, collection.name) : null;

/** The companies to list, read from whichever spelling the payload carries: the id-bearing
 *  `companies` when the backend sends it, the bare names otherwise. Names-only entries get no
 *  studio link, by {@link companyTarget}, but still render. */
export function filmCompanies(film: FilmDetail): FilmCompany[] {
  return film.companies ?? film.production_companies.map((name) => ({ name }));
}

/** The film itself as a follow target — the one thing the film page still offers to follow
 *  (EF-16). `null` when the payload carries no film id, like the builders above, and the page
 *  renders no button for a null target.
 *
 *  A title follow keys on the film's UUID, not its TMDB id: that is what the backend stores
 *  for `entity_type: "title"` and what `GET /me/follows` echoes back, so a button keyed on
 *  anything else would never find its own row in the list. */
export const titleTarget = (film: FilmDetail): FollowTarget | null =>
  target("title", film.id, film.title);
