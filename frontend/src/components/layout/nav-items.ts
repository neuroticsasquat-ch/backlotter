import { SITE_NAME } from "@/lib/seo";

export const WORDMARK = SITE_NAME;

// `enabled` gates whether an item renders as a real link. Keep an item disabled until
// its route exists in routes.ts, or the link 404s wherever it appears (header + footer).
export const NAV_ITEMS = [
  { label: "Home", href: "/", enabled: true },
  { label: "Browse", href: "/browse", enabled: false },
  { label: "Search", href: "/search", enabled: false },
  { label: "Calendar", href: "/calendar", enabled: false },
] as const;
