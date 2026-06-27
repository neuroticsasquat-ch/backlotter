import type { CastMember } from "@/api/types";
import { CollapsibleSection } from "./CollapsibleSection";

/** Cast section: a collapsed disclosure (closed by default) that expands to a
 *  vertical list of cast members, each a single line with the actor name and the
 *  character they play. */
export function FilmCredits({ cast }: { cast: CastMember[] }) {
  if (cast.length === 0) return null;

  return (
    <CollapsibleSection title="Cast" count={cast.length}>
      <ul>
        {cast.map((member, i) => (
          <li key={`${member.name}-${i}`} className="rounded px-2 py-0.5 text-sm odd:bg-muted/40">
            <span className="font-medium">{member.name}</span>
            {member.character && (
              <span className="text-muted-foreground"> · {member.character}</span>
            )}
          </li>
        ))}
      </ul>
    </CollapsibleSection>
  );
}
