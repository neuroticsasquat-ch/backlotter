import type { CrewMember } from "@/api/types";
import { groupCrewByJob } from "@/lib/crew-groups";
import { isFollowableCrew, personTarget } from "@/lib/film-entities";
import { FollowButton } from "@/components/follow/FollowButton";
import { CollapsibleSection } from "./CollapsibleSection";

/** Full crew: a collapsed disclosure (closed by default) that expands to job-title groups,
 *  each a label with the people who share that title listed below it. Mirrors the cast block.
 *  Crew arrives department/job-ordered from the backend; we adjacency-group it by job.
 *  Directors and writers carry a follow button (NEU-1353). */
export function FilmCrew({ crew }: { crew: CrewMember[] }) {
  if (crew.length === 0) return null;
  const groups = groupCrewByJob(crew);

  return (
    <CollapsibleSection title="Crew" count={crew.length}>
      <div className="space-y-2">
        {groups.map((group, i) => (
          <div key={`${group.job}-${i}`}>
            <h3 className="text-xs font-semibold text-muted-foreground">{group.job}</h3>
            <ul>
              {group.people.map((person, i) => {
                const target = isFollowableCrew(person) ? personTarget(person) : null;
                return (
                  <li
                    key={`${person.name}-${i}`}
                    className="flex items-center gap-2 rounded px-2 py-0.5 text-sm font-medium odd:bg-muted/40"
                  >
                    <span className="min-w-0 flex-1">{person.name}</span>
                    {target && <FollowButton target={target} />}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </CollapsibleSection>
  );
}
