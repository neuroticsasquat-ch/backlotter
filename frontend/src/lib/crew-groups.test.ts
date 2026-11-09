import { describe, expect, it } from "vitest";
import { groupCrewByJob } from "@/lib/crew-groups";
import type { CrewMember } from "@/api/types";

function c(name: string, job: string | null): CrewMember {
  return { name, job, department: null };
}

describe("groupCrewByJob", () => {
  it("returns an empty array for no crew", () => {
    expect(groupCrewByJob([])).toEqual([]);
  });

  it("groups adjacent same-job members into one group, preserving input order", () => {
    const groups = groupCrewByJob([
      c("Greta Gerwig", "Director"),
      c("Greta Gerwig", "Screenplay"),
      c("Noah Baumbach", "Screenplay"),
      c("David Heyman", "Producer"),
    ]);
    expect(groups.map((g) => g.job)).toEqual(["Director", "Screenplay", "Producer"]);
    expect(groups[1].people.map((p) => p.name)).toEqual(["Greta Gerwig", "Noah Baumbach"]);
  });

  it("labels a null job as 'Crew'", () => {
    const groups = groupCrewByJob([c("Anon Person", null)]);
    expect(groups[0].job).toBe("Crew");
  });
});
