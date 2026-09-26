import { describe, expect, it } from "vitest";

import type { ArcStage } from "@/api/types";
import {
  NOT_YET_REPORTED_LABEL,
  SECTION_SPLIT_EXPLAINER,
  arcStageLabel,
  confidenceLabel,
  eventTypeLabel,
} from "./labels";

describe("eventTypeLabel", () => {
  it("maps first_look to a friendly label", () => {
    expect(eventTypeLabel("first_look")).toBe("First look");
  });

  it("maps crew_attached to sentence case, not the title-cased fallback", () => {
    expect(eventTypeLabel("crew_attached")).toBe("Crew attached");
  });

  it("maps now_available to sentence case, not the title-cased fallback", () => {
    // The home-release beat (D-28). Without the explicit entry the fallback renders
    // "Now Available", which is the one word of difference the rest of the vocabulary avoids.
    expect(eventTypeLabel("now_available")).toBe("Now available");
  });

  it("names the organisation beats Studio and Franchise, never the payload's words", () => {
    // EF-19: the code keeps `company` / `collection` and the reader never sees either. The
    // title-case fallback would render "Company Attached", which is wrong twice over.
    expect(eventTypeLabel("company_attached")).toBe("Studio attached");
    expect(eventTypeLabel("company_removed")).toBe("Studio removed");
    expect(eventTypeLabel("collection_attached")).toBe("Franchise attached");
    expect(eventTypeLabel("collection_removed")).toBe("Franchise removed");
  });

  it("names the canceled beat", () => {
    expect(eventTypeLabel("canceled")).toBe("Canceled");
  });

  it("still title-cases a beat it has never heard of", () => {
    expect(eventTypeLabel("reshoots_started")).toBe("Reshoots Started");
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

describe("confidenceLabel", () => {
  it("reads a confirmed event as confirmed", () => {
    expect(confidenceLabel("confirmed")).toBe("confirmed");
  });

  it("reads the backend's rumored as unconfirmed", () => {
    expect(confidenceLabel("rumored")).toBe("unconfirmed");
  });

  it("never promotes an unknown value to confirmed", () => {
    expect(confidenceLabel("")).toBe("unconfirmed");
    expect(confidenceLabel("verified")).toBe("unconfirmed");
  });
});

describe("the catalog section heading", () => {
  // Provenance, not truth: "unconfirmed" belongs to the confidence badge alone (NEU-1406).
  it("reads Not yet reported", () => {
    expect(NOT_YET_REPORTED_LABEL).toBe("Not yet reported");
  });

  it("is named by the explainer, so the two cannot drift", () => {
    expect(SECTION_SPLIT_EXPLAINER).toContain(`“${NOT_YET_REPORTED_LABEL}”`);
  });
});
