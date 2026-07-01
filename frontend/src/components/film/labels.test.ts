import { describe, expect, it } from "vitest";

import { eventTypeLabel } from "./labels";

describe("eventTypeLabel", () => {
  it("maps first_look to a friendly label", () => {
    expect(eventTypeLabel("first_look")).toBe("First look");
  });
});
