import { describe, expect, it } from "vitest";

import type { ArcStage } from "@/api/types";
import {
  EVENT_TYPE_LABELS,
  NOT_YET_REPORTED_LABEL,
  SECTION_SPLIT_EXPLAINER,
  arcStageLabel,
  confidenceLabel,
  eventTypeLabel,
} from "./labels";

/** A copy of the backend's `DIGEST_BEAT_LABELS` (`app/services/digest_sender.py`). The digest
 *  mail and the card describe the same beat, so the two maps must be equal key-for-key (NR-14).
 *  When the backend map changes, change this copy and `EVENT_TYPE_LABELS` together. */
const DIGEST_BEAT_LABELS = {
  release_date: "Release date",
  now_available: "Now available",
  trailer: "New trailer",
  announced: "Announced",
  casting: "Casting",
  crew_attached: "Crew attached",
  cast_removed: "Cast departure",
  crew_removed: "Crew departure",
  company_attached: "Studio attached",
  company_removed: "Studio removed",
  collection_attached: "Franchise attached",
  collection_removed: "Franchise removed",
  canceled: "Canceled",
  production_start: "Production started",
  production_wrap: "Production wrapped",
  first_look: "First look",
};

describe("EVENT_TYPE_LABELS", () => {
  it("equals the digest's beat labels, key for key", () => {
    expect(EVENT_TYPE_LABELS).toEqual(DIGEST_BEAT_LABELS);
  });
});

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

  it("reads a pre-split credit removal through the fallback", () => {
    // NR-14: `credit_removed` is retired by the backend migration (NR-12) and has no entry. A
    // stray one during the deploy window reads plainly rather than vanishing.
    expect(eventTypeLabel("credit_removed")).toBe("Credit Removed");
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
