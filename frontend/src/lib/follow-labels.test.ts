import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookupFollowLabel, rememberFollowLabel, resetFollowLabelCache } from "./follow-labels";

beforeEach(() => {
  localStorage.clear();
  resetFollowLabelCache();
});

describe("follow labels", () => {
  it("reads back a remembered name", () => {
    rememberFollowLabel("person", "525", "Christopher Nolan", "/nolan.jpg");
    expect(lookupFollowLabel("person", "525")).toEqual({
      label: "Christopher Nolan",
      imagePath: "/nolan.jpg",
    });
  });

  it("answers null for an entity it has never seen", () => {
    expect(lookupFollowLabel("person", "287")).toBeNull();
  });

  it("keys on the type as well as the id", () => {
    rememberFollowLabel("person", "41", "Someone");
    expect(lookupFollowLabel("company", "41")).toBeNull();
  });

  it("survives a reload: the record is in storage, not only in memory", () => {
    rememberFollowLabel("company", "41", "A24");
    resetFollowLabelCache();
    expect(lookupFollowLabel("company", "41")?.label).toBe("A24");
  });

  it("overwrites a stale name rather than keeping both", () => {
    rememberFollowLabel("franchise", "10", "Star Wars Collection");
    rememberFollowLabel("franchise", "10", "Star Wars");
    expect(lookupFollowLabel("franchise", "10")?.label).toBe("Star Wars");
  });

  it("renders nothing unreadable when storage holds junk", () => {
    localStorage.setItem("backlotter.follow-labels.v1", "not json");
    resetFollowLabelCache();
    expect(lookupFollowLabel("person", "525")).toBeNull();
  });

  it("keeps working when storage throws (private window, blocked site data)", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    rememberFollowLabel("person", "525", "Christopher Nolan");
    // The in-memory mirror still answers, which is the case that matters: the user has just
    // followed someone and is about to look at the list.
    expect(lookupFollowLabel("person", "525")?.label).toBe("Christopher Nolan");
    setItem.mockRestore();
  });

  it("evicts the least recently written entry past the cap", () => {
    for (let i = 0; i < 505; i++) rememberFollowLabel("person", String(i), `Person ${i}`);
    expect(lookupFollowLabel("person", "0")).toBeNull();
    expect(lookupFollowLabel("person", "504")?.label).toBe("Person 504");
  });

  it("re-writing an entry keeps it from being evicted", () => {
    rememberFollowLabel("person", "1", "Kept");
    for (let i = 100; i < 599; i++) rememberFollowLabel("person", String(i), `Person ${i}`);
    // 500 entries now, with "1" the oldest. Touching it moves it to the end, so the next
    // insert evicts the one after it instead.
    rememberFollowLabel("person", "1", "Kept");
    rememberFollowLabel("person", "999", "New");
    expect(lookupFollowLabel("person", "1")?.label).toBe("Kept");
    expect(lookupFollowLabel("person", "100")).toBeNull();
  });
});
