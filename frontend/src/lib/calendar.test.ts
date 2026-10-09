import { describe, expect, it } from "vitest";
import {
  DEFAULT_CALENDAR_ADDRESS,
  calendarPath,
  parseCalendarPath,
  type CalendarAddress,
} from "@/lib/calendar";

/** The four addresses `/calendar` has (NEU-1544, D-1544.1), by the splat the route sees. */
const ADDRESSES: [string, CalendarAddress, string][] = [
  ["", { tab: "all", kind: "theatrical" }, "/calendar"],
  ["at-home", { tab: "all", kind: "home" }, "/calendar/at-home"],
  ["my-films", { tab: "films", kind: "theatrical" }, "/calendar/my-films"],
  ["my-films/at-home", { tab: "films", kind: "home" }, "/calendar/my-films/at-home"],
];

describe("calendarPath", () => {
  it.each(ADDRESSES)("spells %j as its path", (_, address, path) => {
    expect(calendarPath(address)).toBe(path);
  });

  it("gives the default address no segments at all", () => {
    expect(calendarPath(DEFAULT_CALENDAR_ADDRESS)).toBe("/calendar");
  });
});

describe("parseCalendarPath", () => {
  it.each(ADDRESSES)("reads the splat %j", (splat, address) => {
    expect(parseCalendarPath(splat)).toEqual(address);
  });

  it("reads a missing splat as the default address", () => {
    expect(parseCalendarPath(undefined)).toEqual(DEFAULT_CALENDAR_ADDRESS);
  });

  it.each(ADDRESSES)("tolerates a trailing slash on %j", (splat, address) => {
    expect(parseCalendarPath(`${splat}/`)).toEqual(address);
  });

  it.each(ADDRESSES)("round-trips %j through calendarPath", (splat) => {
    const address = parseCalendarPath(splat)!;
    expect(calendarPath(address)).toBe(splat ? `/calendar/${splat}` : "/calendar");
  });

  // Strict about order and spelling: one meaning per URL means one URL per meaning.
  it.each([
    "home",
    "films",
    "at-home/my-films",
    "my-films/x",
    "in-theaters",
    "mine",
    "x/at-home",
    "my-films//at-home",
    "/at-home",
  ])("rejects %j", (splat) => {
    expect(parseCalendarPath(splat)).toBeNull();
  });
});
