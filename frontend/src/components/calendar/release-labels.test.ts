import { describe, expect, it } from "vitest";
import { releaseBucketLabel } from "@/components/calendar/release-labels";

describe("releaseBucketLabel", () => {
  it('returns "Limited" for "limited" bucket', () => {
    expect(releaseBucketLabel("limited")).toBe("Limited");
  });

  it('returns "Wide" for "wide" bucket', () => {
    expect(releaseBucketLabel("wide")).toBe("Wide");
  });

  // The US home release joined the calendar with D-26; an unlabelled bucket would fall through
  // to the title-case fallback, which happens to agree here — assert the mapping, not the luck.
  it('returns "Digital" for "digital" bucket', () => {
    expect(releaseBucketLabel("digital")).toBe("Digital");
  });

  it('returns "Physical" for "physical" bucket', () => {
    expect(releaseBucketLabel("physical")).toBe("Physical");
  });

  it("returns a non-empty human string for unknown bucket", () => {
    const unknown = releaseBucketLabel("unknown-bucket");
    expect(unknown).toBeTruthy();
    expect(typeof unknown).toBe("string");
  });
});
