import { describe, expect, it } from "vitest";
import type { FollowAccess } from "@/components/follow/access";
import { navItemsFor } from "@/components/layout/nav-items";

const calendarItem = (access: FollowAccess) =>
  navItemsFor(access).find((item) => item.label === "Calendar");

describe("navItemsFor — the Calendar item (NEU-1544, D-1544.1)", () => {
  // `/calendar` is All releases for everyone, so a reader with films of their own is sent to
  // the address that opens on them; a hint that turns out wrong is replaced onto `/calendar`.
  it.each(["ready", "hinted"] as const)("sends a %s reader to their own films", (access) => {
    expect(calendarItem(access)).toEqual({
      label: "Calendar",
      href: "/calendar/my-films",
      activePath: "/calendar",
    });
  });

  it.each(["anonymous", "locked"] as const)("sends a %s reader to /calendar", (access) => {
    expect(calendarItem(access)?.href).toBe("/calendar");
  });
});
