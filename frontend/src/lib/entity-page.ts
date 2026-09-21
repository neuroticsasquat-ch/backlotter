/**
 * What the two non-person entity pages differ by — which is only their vocabulary.
 *
 * `company` and `franchise` are what the follow graph keys on and what the payloads spell
 * (EF-19 keeps them in the code); "Studio" and "Franchise" are the only words the reader ever
 * sees. Both spellings live here so the route, its `meta`, its 404 copy and its follow button
 * cannot start disagreeing about which is which.
 */
export type EntityKind = "company" | "franchise";

export const ENTITY_NOUN: Record<EntityKind, string> = {
  company: "Studio",
  franchise: "Franchise",
};

/**
 * The `meta` description for a studio or franchise page: how many films a follow would reach
 * right now.
 *
 * The person page's sentence in shape, because it answers the same question — the page exists
 * to show what following this thing would deliver, and the search result should say so rather
 * than repeat the name. Deliberately *not* shared with `routes/person.tsx`, which ends "and
 * every credit we track": that clause is about credits, which is the one thing a studio and a
 * franchise have none of. Two sentences because there are two things to say, not by oversight.
 *
 * An entity with nothing upcoming falls back to naming what the page does list, rather than
 * advertising a zero.
 */
export function entityPageDescription(kind: EntityKind, name: string, upcoming: number): string {
  const noun = ENTITY_NOUN[kind].toLowerCase();
  return upcoming
    ? `${upcoming} upcoming ${upcoming === 1 ? "film" : "films"} from ${name}, with release dates and what we know so far.`
    : `Release dates and recent releases from the ${noun} ${name}.`;
}
