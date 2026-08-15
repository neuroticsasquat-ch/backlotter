import { describe, expect, it } from "vitest";

import type { ArcStage } from "@/api/types";
import { arcStageLabel, eventTypeLabel } from "./labels";

describe("eventTypeLabel", () => {
  it("maps first_look to a friendly label", () => {
    expect(eventTypeLabel("first_look")).toBe("First look");
  });

  it("maps crew_attached to sentence case, not the title-cased fallback", () => {
    expect(eventTypeLabel("crew_attached")).toBe("Crew attached");
  });
});

describe("arcStageLabel", () => {
  it("returns the label for each known stage", () => {
    expect(arcStageLabel("announced")).toBe("Announced");
    expect(arcStageLabel("shooting")).toBe("Shooting");
    expect(arcStageLabel("wrapped")).toBe("Wrapped");
    expect(arcStageLabel("released")).toBe("Released");
  });

  it("falls back to Announced for a stage the frontend does not know", () => {
    // The backend derives "announced" for an unmapped or absent TMDB status, and this
    // label fills the release year's slot — returning undefined would render a bare "()".
    expect(arcStageLabel("in_limbo" as ArcStage)).toBe("Announced");
  });
});
