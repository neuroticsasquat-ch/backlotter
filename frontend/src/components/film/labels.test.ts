import { describe, expect, it } from "vitest";

import { eventTypeLabel } from "./labels";

describe("eventTypeLabel", () => {
  it("maps first_look to a friendly label", () => {
    expect(eventTypeLabel("first_look")).toBe("First look");
  });

  it("maps crew_attached to sentence case, not the title-cased fallback", () => {
    expect(eventTypeLabel("crew_attached")).toBe("Crew attached");
  });
});
