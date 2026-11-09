import { Link } from "react-router";
import type { CastMember, CrewMember } from "@/api/types";
import { personPath, personTarget } from "@/lib/film-entities";

/**
 * A credited name on the film page, linked to that person's page when the payload identifies
 * them.
 *
 * Identified is {@link personTarget}'s question, not a second test spelled here: it is the one
 * place that decides whether a credit names somebody the follow graph can key on, and it
 * rejects a null id as well as a missing one. Restating it would leave two rules to keep in
 * step, and the narrower of the two would mint a link to `/person/null`. So a payload the
 * catalog cannot fully identify renders plain text.
 *
 * Every person on the film page goes through this — the header's billing rows as well as the
 * cast and crew lists — because the link is the only way to follow somebody from here now
 * (EF-16), so a name it silently declined to link would be a person the reader cannot reach.
 */
export function PersonName({
  person,
  className,
}: {
  person: CastMember | CrewMember;
  className?: string;
}) {
  const target = personTarget(person);
  if (!target) {
    return <span className={className}>{person.name}</span>;
  }
  return (
    <Link to={personPath(target.entityId, target.label)} className={className}>
      <span className="hover:underline">{person.name}</span>
    </Link>
  );
}
