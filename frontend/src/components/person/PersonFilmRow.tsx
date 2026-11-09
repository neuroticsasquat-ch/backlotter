import type { PersonCredit, PersonFilm } from "@/api/types";
import { EntityFilmRow } from "@/components/entity/EntityFilmRow";

/** One credit, in the word the reader knows it by: a crew member's job, a cast member's
 *  character. Both are nullable in the catalog — an uncredited crew role, a cast entry TMDB
 *  has no character for — so each falls back to its own kind rather than to an empty segment
 *  that would leave the line ending in a separator. */
function creditLabel(credit: PersonCredit): string {
  if (credit.credit_type === "crew") return credit.job ?? "Crew";
  return credit.character ?? "Cast";
}

/**
 * One film on a person's page: {@link EntityFilmRow} plus what they did on it — the one thing
 * a studio and a franchise have no equivalent of.
 *
 * There is no tier badge any more (EF-1). It named the narrowest coverage setting that would
 * reach this film, and with a follow binary every row here is one a follow delivers: a badge
 * saying so on every row is noise, and a badge distinguishing rows would be a distinction the
 * backend no longer makes.
 *
 * The credits are rendered in the order the backend sent them — narrowest first, then
 * billing — rather than re-sorted here, so "Director · Writer" reads the same way on both
 * sides of the wire.
 */
export function PersonFilmRow({ row }: { row: PersonFilm }) {
  const { film, credits } = row;

  return (
    <EntityFilmRow film={film}>
      {credits.length > 0 && (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {credits.map(creditLabel).join(" · ")}
        </p>
      )}
    </EntityFilmRow>
  );
}
