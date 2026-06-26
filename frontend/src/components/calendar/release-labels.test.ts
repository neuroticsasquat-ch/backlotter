import { describe, expect, it } from "vitest";
import { releaseBucketLabel } from "@/components/calendar/release-labels";

describe("releaseBucketLabel", () => {
  it('returns "Premiere" for "premiere" bucket', () => {
    expect(releaseBucketLabel("premiere")).toBe("Premiere");
  });

  it('returns "Limited release" for "limited" bucket', () => {
    expect(releaseBucketLabel("limited")).toBe("Limited release");
  });

  it('returns "Wide release" for "wide" bucket', () => {
    expect(releaseBucketLabel("wide")).toBe("Wide release");
  });

  it("returns a non-empty human string for unknown bucket", () => {
    const unknown = releaseBucketLabel("unknown-bucket");
    expect(unknown).toBeTruthy();
    expect(typeof unknown).toBe("string");
  });
});
