import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/components/AuthContext";
import type { FollowTarget } from "@/lib/film-entities";
import { ApiError, apiFetch } from "./client";
import type {
  AlertPref,
  Follow,
  FollowListResponse,
  WatchlistFilm,
  WatchlistItem,
  WatchlistListResponse,
} from "./types";

/** Query keys for the two collections this module owns. Both sit under `["me"]`, the account
 *  query's key, so `AuthContext.refresh()` — which invalidates that prefix — refreshes the
 *  follow graph alongside the account it belongs to. Exported so every caller spells them the
 *  same way; a key built inline at a call site is a cache that never gets updated. */
export const followsKey = ["me", "follows"] as const;
export const watchlistKey = ["me", "watchlist"] as const;

export const fetchFollows = () => apiFetch<FollowListResponse>("/me/follows");

export const fetchWatchlist = () => apiFetch<WatchlistListResponse>("/me/watchlist");

export const createFollow = (target: FollowTarget) =>
  apiFetch<Follow>("/me/follows", {
    method: "POST",
    body: JSON.stringify({ entity_type: target.entityType, entity_id: target.entityId }),
  });

export const deleteFollow = (target: FollowTarget) =>
  apiFetch<void>(`/me/follows/${target.entityType}/${encodeURIComponent(target.entityId)}`, {
    method: "DELETE",
  });

export const addToWatchlist = (filmId: string) =>
  apiFetch<WatchlistItem>("/me/watchlist", {
    method: "POST",
    body: JSON.stringify({ film_id: filmId }),
  });

export const removeFromWatchlist = (filmId: string) =>
  apiFetch<void>(`/me/watchlist/${encodeURIComponent(filmId)}`, { method: "DELETE" });

/** The 403 the `/me/*` routes answer with for a signed-in account that has not been granted
 *  access (D-39). It is a state to render, not a failure to report: the user is told what
 *  they are missing by the locked button beside them, so a red toast on top would be noise. */
export function isEntitlementError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 403) return false;
  const body = error.body;
  return (
    typeof body === "object" &&
    body !== null &&
    "detail" in body &&
    body.detail === "entitlement_required"
  );
}

/** A grant that lapsed mid-session shows up as that 403 and nowhere else — the cached account
 *  still says `entitled`. Re-reading `/me` flips it, which re-renders every follow button on
 *  the page into its locked state. `exact` so the collections below, which are about to be
 *  refetched by their own mutation, are not invalidated twice. */
const refreshAccount = (qc: QueryClient) => qc.invalidateQueries({ queryKey: ["me"], exact: true });

/** Whether the signed-in account may read the follow graph at all. Both collections are
 *  subscriber-only, so an unentitled account would only ever get the 403 above, and a
 *  signed-out one a 401 — neither is worth a request. Under SSR the account query never
 *  resolves, so this is false there and the server render fetches nothing. */
function useFollowGraphEnabled(): boolean {
  const { user } = useAuth();
  return Boolean(user?.entitled);
}

export function useFollows() {
  const enabled = useFollowGraphEnabled();
  return useQuery({
    queryKey: followsKey,
    queryFn: fetchFollows,
    enabled,
    staleTime: 60_000,
  });
}

export function useWatchlist() {
  const enabled = useFollowGraphEnabled();
  return useQuery({
    queryKey: watchlistKey,
    queryFn: fetchWatchlist,
    enabled,
    staleTime: 60_000,
  });
}

const sameEntity = (follow: Follow, target: FollowTarget) =>
  follow.entity_type === target.entityType && follow.entity_id === target.entityId;

/** Whether the user already follows a target, read from the one cached list rather than a
 *  request per button — a film page carries a dozen of these. */
export function useIsFollowing(target: FollowTarget | null): boolean {
  const { data } = useFollows();
  if (!target) return false;
  return (data?.items ?? []).some((follow) => sameEntity(follow, target));
}

export function useIsOnWatchlist(filmId: string | null): boolean {
  const { data } = useWatchlist();
  if (!filmId) return false;
  return (data?.items ?? []).some((item) => item.film.id === filmId);
}

/** Follow or unfollow, applied to the cached list before the request goes out so the button
 *  flips under the user's finger. `following` is the state the target is in *now*, so the
 *  mutation moves it to the other one. */
export function useToggleFollow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ target, following }: { target: FollowTarget; following: boolean }) => {
      if (following) await deleteFollow(target);
      else await createFollow(target);
    },
    onMutate: async ({ target, following }) => {
      await qc.cancelQueries({ queryKey: followsKey });
      // The row as it stands, not the whole list: a page carries a dozen of these buttons, and
      // restoring a list snapshot on one failure would throw away every other button's
      // in-flight optimistic update. Undoing just this entity leaves the rest alone.
      const removed = qc
        .getQueryData<FollowListResponse>(followsKey)
        ?.items.find((f) => sameEntity(f, target));
      qc.setQueryData<FollowListResponse>(followsKey, (old) => {
        const items = old?.items ?? [];
        if (following) return { items: items.filter((f) => !sameEntity(f, target)) };
        const optimistic: Follow = {
          entity_type: target.entityType,
          entity_id: target.entityId,
          source: "manual",
          created_at: new Date().toISOString(),
        };
        return { items: [...items, optimistic] };
      });
      return { removed };
    },
    onError: (error, { target, following }, context) => {
      qc.setQueryData<FollowListResponse>(followsKey, (old) => {
        const items = old?.items ?? [];
        // A failed unfollow puts the row back as it was; a failed follow takes the optimistic
        // one away again.
        if (following) return context?.removed ? { items: [...items, context.removed] } : { items };
        return { items: items.filter((f) => !sameEntity(f, target)) };
      });
      if (isEntitlementError(error)) {
        void refreshAccount(qc);
        return;
      }
      toast.error(error instanceof Error ? error.message : "Failed to update your follows");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: followsKey }),
  });
}

/** Add or remove the film, on the same terms as {@link useToggleFollow}. The optimistic entry
 *  carries the film the page is already rendering, so the cached list is a real row rather
 *  than a placeholder the watchlist page would have to tolerate; the refetch replaces it with
 *  the server's, which is where `source` and `alert_prefs` become authoritative. */
export function useToggleWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ film, onList }: { film: WatchlistFilm; onList: boolean }) => {
      if (onList) await removeFromWatchlist(film.id);
      else await addToWatchlist(film.id);
    },
    onMutate: async ({ film, onList }) => {
      await qc.cancelQueries({ queryKey: watchlistKey });
      // Just this film's row, for the reason given in `useToggleFollow`.
      const removed = qc
        .getQueryData<WatchlistListResponse>(watchlistKey)
        ?.items.find((item) => item.film.id === film.id);
      qc.setQueryData<WatchlistListResponse>(watchlistKey, (old) => {
        const items = old?.items ?? [];
        if (onList) return { items: items.filter((item) => item.film.id !== film.id) };
        // `{stream}` is the default the backend applies to an item added without prefs (D-14).
        const optimistic: WatchlistItem = {
          film,
          source: "manual",
          alert_prefs: ["stream"] as AlertPref[],
          created_at: new Date().toISOString(),
        };
        return { items: [...items, optimistic] };
      });
      return { removed };
    },
    onError: (error, { film, onList }, context) => {
      qc.setQueryData<WatchlistListResponse>(watchlistKey, (old) => {
        const items = old?.items ?? [];
        if (onList) return context?.removed ? { items: [...items, context.removed] } : { items };
        return { items: items.filter((item) => item.film.id !== film.id) };
      });
      if (isEntitlementError(error)) {
        void refreshAccount(qc);
        return;
      }
      toast.error(error instanceof Error ? error.message : "Failed to update your watchlist");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: watchlistKey }),
  });
}
