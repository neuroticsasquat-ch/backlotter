/** Secondary navigation shown on every admin page (rendered by AdminLayout). Add a line
 *  here when a new admin page is introduced. */
export const ADMIN_NAV_ITEMS = [
  { label: "Ingestion", href: "/admin/ingest" },
  { label: "Sources", href: "/admin/sources" },
] as const;
