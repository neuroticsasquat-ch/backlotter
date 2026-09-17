import { SITE_NAME } from "@/lib/seo";

export const WORDMARK = SITE_NAME;

// Nav destinations. "Updates" is home, which is the reader's own timeline once they are signed
// in and granted access (NEU-1354) and the global feed otherwise; "All updates" is that global
// feed under its own URL, so it stays reachable either way and is listed for everyone rather
// than only for the readers whose home page moved. Search is the separate header search box and
// account links (Log in) render alongside, so those aren't listed here. `enabled` gates whether
// an item renders as a real link. The "/" item uses an exact (end) match.
export const NAV_ITEMS = [
  { label: "Updates", href: "/", enabled: true },
  { label: "All updates", href: "/feed", enabled: true },
  { label: "Calendar", href: "/calendar", enabled: true },
] as const;
