import { useEffect, useState } from "react";
import {
  DEFAULT_PAGE_SIZE,
  entitlementState,
  oneYearOut,
  toExpiryInstant,
  useAdminUsers,
  useGrantEntitlement,
  useRevokeEntitlement,
  type EntitlementState,
} from "@/api/users";
import type { AdminUser } from "@/api/types";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatEventDate } from "@/lib/format";

const STATE_STYLES: Record<EntitlementState, string> = {
  active: "bg-green-100 text-green-800",
  expired: "bg-amber-100 text-amber-800",
  none: "",
};

/** An expired grant renders as expired rather than as never-granted, and never disappears
 *  from the list — extending a lapsed grant and making a first one are different decisions. */
function AccessCell({ row }: { row: AdminUser }) {
  const state = entitlementState(row);
  // The null check reads as redundant next to `state === "none"` but is load-bearing: it is
  // what narrows `entitled_until` to a string for the formatEventDate call below.
  if (state === "none" || row.entitled_until === null) {
    return <span className="text-muted-foreground">No access</span>;
  }
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATE_STYLES[state]}`}>
      {state === "expired" ? "Expired " : "Until "}
      {formatEventDate(row.entitled_until)}
    </span>
  );
}

function GrantControls({ row }: { row: AdminUser }) {
  const [date, setDate] = useState(() => oneYearOut());
  const grant = useGrantEntitlement();
  const revoke = useRevokeEntitlement();
  const state = entitlementState(row);
  const busy = grant.isPending || revoke.isPending;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="date"
        aria-label={`Access until for ${row.email}`}
        value={date}
        disabled={busy}
        onChange={(e) => setDate(e.target.value)}
        className="rounded border px-2 py-1 text-sm disabled:opacity-50"
      />
      <Button
        size="sm"
        aria-label={`${state === "active" ? "Extend" : "Grant"} access for ${row.email}`}
        disabled={busy || date === ""}
        onClick={() => grant.mutate({ userId: row.id, entitledUntil: toExpiryInstant(date) })}
      >
        {state === "active" ? "Extend" : "Grant"}
      </Button>
      {row.entitled_until !== null && (
        <ConfirmDialog
          trigger={
            <Button
              size="sm"
              variant="destructive"
              aria-label={`Revoke access for ${row.email}`}
              disabled={busy}
            >
              Revoke
            </Button>
          }
          title="Revoke access?"
          description={`${row.email} loses access immediately. Their follows, watchlist and settings are kept, so a later grant restores the account as it was.`}
          confirmLabel="Revoke"
          onConfirm={() => revoke.mutate({ userId: row.id })}
        />
      )}
    </div>
  );
}

export function AdminUsers() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);

  // Debounced so a search is one request per pause, not one per keystroke. The page falls
  // back to the first page whenever the query changes — offset 3 of the old result set says
  // nothing about the new one.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setOffset(0);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError, error } = useAdminUsers({ q: query, offset });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + items.length < total;

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold">Users</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Access is closed by default. Granting it here is the only way in until subscriptions ship.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <input
          type="search"
          aria-label="Search accounts"
          placeholder="Search by email…"
          // The backend caps `q` at 320 (an email's max length); a longer one is a 422, not
          // a search with no results.
          maxLength={320}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
        />
      </div>

      {isLoading && <p className="mt-4 text-muted-foreground">Loading accounts…</p>}

      {isError && (
        <p className="mt-4 text-red-600">
          Failed to load accounts{error instanceof Error ? `: ${error.message}` : ""}.
        </p>
      )}

      {data && items.length === 0 && (
        <p className="mt-4 text-muted-foreground">
          {query ? "No accounts match your search." : "No accounts yet."}
        </p>
      )}

      {items.length > 0 && (
        <>
          <table className="mt-4 w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4 font-medium">Email</th>
                <th className="py-2 pr-4 font-medium">Signed up</th>
                <th className="py-2 pr-4 font-medium">Verified</th>
                <th className="py-2 pr-4 font-medium">Access until</th>
                <th className="py-2 pr-4 font-medium">Admin</th>
                <th className="py-2 font-medium">Grant</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-b align-top">
                  <td className="py-2 pr-4 font-medium">{row.email}</td>
                  <td className="py-2 pr-4">{formatEventDate(row.created_at)}</td>
                  <td className="py-2 pr-4">
                    {row.email_verified_at ? (
                      formatEventDate(row.email_verified_at)
                    ) : (
                      <span className="text-muted-foreground">Unverified</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <AccessCell row={row} />
                  </td>
                  <td className="py-2 pr-4">
                    {row.is_admin ? "Admin" : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="py-2">
                    <GrantControls row={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
            <span>
              {offset + 1}–{offset + items.length} of {total}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={!hasPrev}
              onClick={() => setOffset((o) => Math.max(0, o - DEFAULT_PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!hasNext}
              onClick={() => setOffset((o) => o + DEFAULT_PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export default AdminUsers;
