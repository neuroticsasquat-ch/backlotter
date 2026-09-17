import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch } from "./client";
import type { AdminUser, AdminUserPage } from "./types";

export type AdminUserQuery = { q?: string; limit?: number; offset?: number };

export const DEFAULT_PAGE_SIZE = 50;

export function fetchAdminUsers({ q, limit = DEFAULT_PAGE_SIZE, offset = 0 }: AdminUserQuery = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  // Omitted rather than sent empty: the backend narrows on any `q` it is given, and a blank
  // one would be a substring match against every address rather than no filter at all.
  if (q) params.set("q", q);
  return apiFetch<AdminUserPage>(`/admin/users?${params}`);
}

/** Set an account's access expiry — the one write that grants access or extends a grant.
 *  PUT, not POST, because it is idempotent by construction: the body carries the new expiry
 *  outright rather than a duration to add, so replaying it lands the same date (D-38). */
export const grantEntitlement = (userId: string, entitledUntil: string) =>
  apiFetch<AdminUser>(`/admin/users/${encodeURIComponent(userId)}/entitlement`, {
    method: "PUT",
    body: JSON.stringify({ entitled_until: entitledUntil }),
  });

/** End an account's access, returning it to the state every signup starts in. Suppresses,
 *  never destroys (D-40): the row survives, so a later grant restores the account as it was. */
export const revokeEntitlement = (userId: string) =>
  apiFetch<AdminUser>(`/admin/users/${encodeURIComponent(userId)}/entitlement`, {
    method: "DELETE",
  });

/** Where an account stands with respect to its grant. `expired` is deliberately distinct
 *  from `none`: "lapsed last month" and "never had access" are the difference between
 *  extending a grant and making one, so the page must not collapse them (D-38). */
export type EntitlementState = "none" | "active" | "expired";

export function entitlementState(row: AdminUser, now: Date = new Date()): EntitlementState {
  if (row.entitled_until === null) return "none";
  return new Date(row.entitled_until) > now ? "active" : "expired";
}

/** The date a grant control starts on: a year from today, the grant this page hands out
 *  unless the admin says otherwise. UTC throughout, matching how the expiry is sent and
 *  rendered, and non-mutating — it copies the date it is given. */
export function oneYearOut(from: Date = new Date()): string {
  const d = new Date(from);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

/** `<input type="date">` yields a bare "YYYY-MM-DD"; the backend wants a datetime and reads a
 *  naive one as UTC. Sending the zone explicitly means the admin gets the day they picked
 *  rather than one shifted by whichever timezone either end happens to be in.
 *
 *  The *end* of the picked day, not its start. The backend rule is exclusive — entitled iff
 *  `entitled_until > now()` (D-37) — so a grant stamped midnight would end access at the
 *  start of the day the column calls "Access until", making the labelled day itself read as
 *  expired and a "one year out" default 364 days long. Ending at 23:59:59Z makes the label
 *  honest: access runs through the whole of the day the admin picked. */
export function toExpiryInstant(date: string): string {
  return `${date}T23:59:59Z`;
}

/** One page of accounts for the grant page. `keepPreviousData` holds the current rows on
 *  screen while a new search or page loads, so typing in the search box doesn't flash the
 *  table through an empty loading state on every keystroke. */
export function useAdminUsers(params: AdminUserQuery = {}) {
  const { q, limit = DEFAULT_PAGE_SIZE, offset = 0 } = params;
  return useQuery({
    queryKey: ["admin-users", { q: q ?? "", limit, offset }],
    queryFn: () => fetchAdminUsers({ q, limit, offset }),
    placeholderData: keepPreviousData,
  });
}

/** Patch one account into every cached page of the list. Both mutations answer with the
 *  updated row precisely so the page can re-render what it just changed without a refetch;
 *  a row absent from a given page is left alone. */
function useWriteBackAccount() {
  const qc = useQueryClient();
  return (updated: AdminUser) => {
    qc.setQueriesData<AdminUserPage>({ queryKey: ["admin-users"] }, (old) =>
      old ? { ...old, items: old.items.map((u) => (u.id === updated.id ? updated : u)) } : old,
    );
  };
}

export function useGrantEntitlement() {
  const writeBack = useWriteBackAccount();
  return useMutation({
    mutationFn: ({ userId, entitledUntil }: { userId: string; entitledUntil: string }) =>
      grantEntitlement(userId, entitledUntil),
    onSuccess: (updated) => {
      writeBack(updated);
      toast.success(`Access granted for ${updated.email}`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to grant access");
    },
  });
}

export function useRevokeEntitlement() {
  const writeBack = useWriteBackAccount();
  return useMutation({
    mutationFn: ({ userId }: { userId: string }) => revokeEntitlement(userId),
    onSuccess: (updated) => {
      writeBack(updated);
      toast.success(`Access revoked for ${updated.email}`);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to revoke access");
    },
  });
}
