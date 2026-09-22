import { Link } from "react-router";
import type { FilmRow } from "@/api/types";
import { FollowButton } from "@/components/follow/FollowButton";
import { EntityFilmRow, EntityFilmSection } from "./EntityFilmRow";
import { ENTITY_NOUN, type EntityKind } from "@/lib/entity-page";
import type { FollowTarget } from "@/lib/film-entities";
import { logoUrl, posterUrl } from "@/lib/poster";

/** A studio or a franchise, flattened to the fields its page draws — the two payloads differ
 *  only in whether the image arrives as `logo_path` or `poster_path`, and the route picks the
 *  one its payload carries before handing it over.
 *
 *  `imagePath` stays the bare TMDB path rather than a resolved URL: it rides on the follow
 *  target too, where the optimistic `/me/follows` row wants exactly what the API stores. */
export interface EntitySubject {
  id: number;
  name: string;
  imagePath: string | null;
  upcoming: FilmRow[];
  recent: FilmRow[];
}

/**
 * The studio and franchise pages (EF-17), which are one page with two vocabularies.
 *
 * The person page's shape — name, image, the follow button, then Upcoming and Recently
 * released — minus everything that is about credits. A studio's relationship to a film is a
 * membership row and a franchise's is a column on the film: there is no job to name, and
 * nothing to narrow, so the rows are bare and the control is the plain {@link FollowButton}
 * rather than the person page's tiered one. Coverage is a person-follow setting (D-43) and the
 * backend refuses a PATCH of it on these two types outright.
 *
 * This page is where a studio or franchise follow is made, and since EF-16 it is the *only*
 * place: the film page lists both and links them here rather than offering a button of its
 * own.
 */
export function EntityPage({ kind, subject }: { kind: EntityKind; subject: EntitySubject }) {
  const noun = ENTITY_NOUN[kind];
  // A company's image is a logo and a collection's is a poster, which TMDB serves from
  // different paths; both are asked for at the width the header box renders.
  const image =
    kind === "company" ? logoUrl(subject.imagePath, "w185") : posterUrl(subject.imagePath, "w185");
  const target: FollowTarget = {
    entityType: kind,
    entityId: String(subject.id),
    label: subject.name,
    imagePath: subject.imagePath,
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="flex gap-4">
        {image ? (
          <img
            src={image}
            alt=""
            // `contain` on a white-padded box, not the person page's `cover`: a TMDB company
            // logo is a wide transparent PNG that a square crop would behead, and a collection
            // poster is a poster — one box has to hold both without cropping either.
            className="h-28 w-20 flex-none rounded bg-white/90 object-contain p-1.5 sm:h-36 sm:w-24"
          />
        ) : (
          <div
            aria-hidden="true"
            className="h-28 w-20 flex-none rounded bg-muted sm:h-36 sm:w-24"
          />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold text-foreground">{subject.name}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{noun}</p>
          <div className="mt-3">
            <FollowButton target={target} />
          </div>
        </div>
      </header>

      {/* Two sections and nothing else, for the person page's reason: between them they are
          exactly what a follow can reach (D-46), so the page shows what following this studio
          or franchise would deliver rather than its whole back catalogue. */}
      <EntityFilmSection
        heading="Upcoming"
        count={subject.upcoming.length}
        empty="No upcoming films in the catalog"
      >
        {subject.upcoming.map((film) => (
          <EntityFilmRow key={film.id} film={film} />
        ))}
      </EntityFilmSection>
      <EntityFilmSection
        heading="Recently released"
        count={subject.recent.length}
        empty="No recent releases"
      >
        {subject.recent.map((film) => (
          <EntityFilmRow key={film.id} film={film} />
        ))}
      </EntityFilmSection>
    </main>
  );
}

/** The 404 (and the catch-all) both pages render, in each one's own noun. */
export function EntityNotFound({ kind, isNotFound }: { kind: EntityKind; isNotFound: boolean }) {
  const noun = ENTITY_NOUN[kind].toLowerCase();
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">
        {isNotFound ? `${ENTITY_NOUN[kind]} not found` : "Something went wrong"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {isNotFound
          ? `We couldn't find that ${noun}. It may have moved or never existed.`
          : "Please try again in a moment."}
      </p>
      <Link to="/" className="mt-6 inline-block text-sm text-blue-600 underline">
        Back to home
      </Link>
    </main>
  );
}
