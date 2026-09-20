import type { CastMember } from "@/api/types";
import { FOLLOWABLE_CAST_COUNT, personTarget } from "@/lib/film-entities";
import { FollowButton } from "@/components/follow/FollowButton";
import { PersonName } from "./PersonName";
import { CollapsibleSection } from "./CollapsibleSection";

/** Cast section: a collapsed disclosure (closed by default) that expands to a
 *  vertical list of cast members, each a single line with the actor name and the
 *  character they play. The top billed rows carry a follow button (NEU-1353), and every row's
 *  name links to that person's page (NEU-1419) — the button stays where it was, because the
 *  tier it follows at is a choice the person page is built to offer and this row is not.
 *
 *  The whole cast is listed now that the backend stopped capping it at twelve (D-1416.7); the
 *  section is closed by default, so the extra rows cost the page nothing until it is opened. */
export function FilmCredits({ cast }: { cast: CastMember[] }) {
  if (cast.length === 0) return null;

  return (
    <CollapsibleSection title="Cast" count={cast.length}>
      <ul>
        {cast.map((member, i) => {
          const target = i < FOLLOWABLE_CAST_COUNT ? personTarget(member) : null;
          return (
            <li
              key={`${member.name}-${i}`}
              className="flex items-center gap-2 rounded px-2 py-0.5 text-sm odd:bg-muted/40"
            >
              <span className="min-w-0 flex-1">
                <PersonName person={member} className="font-medium" />
                {member.character && (
                  <span className="text-muted-foreground"> · {member.character}</span>
                )}
              </span>
              {target && <FollowButton target={target} />}
            </li>
          );
        })}
      </ul>
    </CollapsibleSection>
  );
}
