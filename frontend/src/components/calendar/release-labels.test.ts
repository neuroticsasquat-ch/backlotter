import { describe, expect, it } from "vitest";
import { releaseBucketLabel } from "@/components/calendar/release-labels";

describe("releaseBucketLabel", () => {
  it('returns "Limited" for "limited" bucket', () => {
    expect(releaseBucketLabel("limited")).toBe("Limited");
  });

  it('returns "Wide" for "wide" bucket', () => {
    expect(releaseBucketLabel("wide")).toBe("Wide");
  });

  it("returns a non-empty human string for unknown bucket", () => {
    const unknown = releaseBucketLabel("unknown-bucket");
    expect(unknown).toBeTruthy();
    expect(typeof unknown).toBe("string");
  });
});
