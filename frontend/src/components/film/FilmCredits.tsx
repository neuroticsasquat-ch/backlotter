import type { CastMember } from "@/api/types";
import { PersonName } from "./PersonName";
import { CollapsibleSection } from "./CollapsibleSection";

/** Cast section: a collapsed disclosure (closed by default) that expands to a
 *  vertical list of cast members, each a single line with the actor name and the
 *  character they play.
 *
 *  Every row's name links to that person's page and no row carries a follow button (EF-16).
 *  The buttons were on the top-billed rows only, on D-11's seed grade, which made the page
 *  quietly assert that an 8th-billed actor was not worth following — a claim the person page
 *  disagrees with. Following happens there now, where the reader can see what the follow
 *  would actually deliver (EF-18), and this list's job is to get them there.
 *
 *  The whole cast is listed now that the backend stopped capping it at twelve (D-1416.7); the
 *  section is closed by default, so the extra rows cost the page nothing until it is opened. */
export function FilmCredits({ cast }: { cast: CastMember[] }) {
  if (cast.length === 0) return null;

  return (
    <CollapsibleSection title="Cast" count={cast.length}>
      <ul>
        {cast.map((member, i) => (
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
          </li>
        ))}
      </ul>
    </CollapsibleSection>
  );
}
