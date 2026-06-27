import type { CrewMember } from "@/api/types";

export interface CrewJobGroup {
  job: string; // job title label; null jobs collapse to "Crew"
  people: CrewMember[];
}

/**
 * Group a backend-ordered crew list (department priority → job → credit_order) into per-job
 * sections via an adjacency walk — same approach as groupByReleaseDate. No sorting, so SSR and
 * client output match. A null job is labeled "Crew".
 */
export function groupCrewByJob(crew: CrewMember[]): CrewJobGroup[] {
  const groups: CrewJobGroup[] = [];
  for (const member of crew) {
    const job = member.job ?? "Crew";
    const last = groups[groups.length - 1];
    if (!last || last.job !== job) {
      groups.push({ job, people: [member] });
    } else {
      last.people.push(member);
    }
  }
  return groups;
}
