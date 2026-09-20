import type {
  CastMember,
  CoveringFollow,
  CrewMember,
  FilmCollection,
  FilmCompany,
  FilmDetail,
  FollowEntityType,
  WatchlistFilm,
} from "@/api/types";

/**
 * Is this cover the film's own direct title follow, rather than a person, company or franchise
 * that reaches it?
 *
 * Load-bearing in two places that have to agree — the label on the watchlist row's button and
 * the optimistic cache edit behind it — because it is what decides whether *stop* mutes the
 * film or takes it off the list outright. One definition, so the two cannot drift apart and
 * start describing different acts.
 */
export const isDirectTitleCover = (cover: CoveringFollow, filmId: string) =>
  cover.entity_type === "title" && cover.entity_id === filmId;

/** Whether anything but the film's own title follow covers it — so *stop* leaves it on the
 *  list, muted, rather than removing it. */
export const coveredBeyondTitleFollow = (covers: CoveringFollow[], filmId: string) =>
  covers.some((cover) => !isDirectTitleCover(cover, filmId));

/** One thing on the film page that can be followed: what the follow graph needs to key on
 *  (D-10), plus the name to put in the button's accessible label. */
export interface FollowTarget {
  entityType: FollowEntityType;
  entityId: string;
  /** The entity's own name — "Christopher Nolan", not "Follow Christopher Nolan". */
  label: string;
  /** TMDB image path for the entity, where the source that built this target had one. Carried
   *  so that following remembers a face as well as a name (`lib/follow-labels.ts`); the film
   *  page's builders below leave it undefined, which costs the follows page an avatar and
   *  nothing else. */
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

export const titleTarget = (film: FilmDetail): FollowTarget | null =>
  target("title", film.id, film.title);

export const personTarget = (person: CastMember | CrewMember): FollowTarget | null =>
  target("person", person.person_id, person.name);

export const companyTarget = (company: FilmCompany): FollowTarget | null =>
  target("company", company.id, company.name);

export const collectionTarget = (collection: FilmCollection | null): FollowTarget | null =>
  collection ? target("franchise", collection.id, collection.name) : null;

/** The companies to list, read from whichever spelling the payload carries: the id-bearing
 *  `companies` when the backend sends it, the bare names otherwise. Names-only entries get no
 *  follow button, by {@link companyTarget}, but still render. */
export function filmCompanies(film: FilmDetail): FilmCompany[] {
  return film.companies ?? film.production_companies.map((name) => ({ name }));
}

/** The cast rows that get a follow button: the top five by billing (D-11's seed grade). The
 *  backend sends up to twelve, billing-ordered; following someone credited below the fifth
 *  slot would put nothing on the user's timeline for this film, so the button stops there. */
export const FOLLOWABLE_CAST_COUNT = 5;

/** The crew jobs that get one, on the same rule: seed grade as the backend defines it, which
 *  is `Director` plus `WRITER_JOBS` in its `catalog/seed_grade.py` — and deliberately not
 *  `Story`, whose holder gets no timeline rows for this film for exactly the reason a
 *  cinematographer does not. */
const FOLLOWABLE_CREW_JOBS = new Set(["Director", "Writer", "Screenplay"]);

export const isFollowableCrew = (person: CrewMember): boolean =>
  person.job !== null && FOLLOWABLE_CREW_JOBS.has(person.job);

/** The film as a watchlist row, for the optimistic entry the toggle writes into the cached
 *  list before the server answers. `null` when the film has no id, like the targets above.
 *
 *  The slug is the decorative half of the ref (`<tmdb_id>-<slug>`); a ref that is a bare id
 *  has none, and `null` is what the backend stores for that case. */
export function watchlistFilm(film: FilmDetail): WatchlistFilm | null {
  if (film.id === undefined) return null;
  const dash = film.ref.indexOf("-");
  return {
    id: film.id,
    tmdb_id: film.tmdb_id,
    slug: dash === -1 ? null : film.ref.slice(dash + 1),
    title: film.title,
    poster_path: film.poster_path,
    // No headline release: choosing one is the backend's job (NEU-1397), over per-country rows
    // and a tie-break the film page would have to reimplement to guess at. The row reads "No
    // date yet" for the moment the optimistic entry is up, and the refetch supplies the real
    // one — the same deal `covered_by` takes.
    headline_release: null,
  };
}
