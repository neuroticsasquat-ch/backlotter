import { SITE_NAME } from "@/lib/seo";

export const WORDMARK = SITE_NAME;

// Nav destinations. "Updates" is the home feed; Search is the separate header search box
// and account links (Log in) render alongside, so those aren't listed here. `enabled`
// gates whether an item renders as a real link. The "/" item uses an exact (end) match.
export const NAV_ITEMS = [
  { label: "Updates", href: "/", enabled: true },
  { label: "Calendar", href: "/calendar", enabled: true },
] as const;
