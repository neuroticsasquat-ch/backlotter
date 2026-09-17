import type { CastMember } from "@/api/types";
import { FOLLOWABLE_CAST_COUNT, personTarget } from "@/lib/film-entities";
import { FollowButton } from "@/components/follow/FollowButton";
import { CollapsibleSection } from "./CollapsibleSection";

/** Cast section: a collapsed disclosure (closed by default) that expands to a
 *  vertical list of cast members, each a single line with the actor name and the
 *  character they play. The top billed rows carry a follow button (NEU-1353). */
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
                <span className="font-medium">{member.name}</span>
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
