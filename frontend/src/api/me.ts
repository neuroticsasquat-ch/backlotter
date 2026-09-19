import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/components/AuthContext";
import type { FollowTarget } from "@/lib/film-entities";
import { rememberFollowLabel } from "@/lib/follow-labels";
import { ApiError, apiFetch } from "./client";
import { followsKey, settingsKey, timelineKey, timelinePageKey, watchlistKey } from "./query-keys";
import type {
  AlertPref,
  DigestCadence,
  FeedDayResponse,
  Follow,
  FollowListResponse,
  UserSettings,
  WatchlistFilm,
  WatchlistItem,
  WatchlistListResponse,
} from "./types";

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

/** Replace an item's alert preferences (D-14). PATCH takes the whole set, not a delta — an
 *  empty list is "no availability alerts", which is a real choice and distinct from the
 *  `{stream}` default an item is created with. */
export const updateAlertPrefs = (filmId: string, alertPrefs: AlertPref[]) =>
  apiFetch<WatchlistItem>(`/me/watchlist/${encodeURIComponent(filmId)}`, {
    method: "PATCH",
    body: JSON.stringify({ alert_prefs: alertPrefs }),
  });

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

/** One page of the signed-in user's timeline: the grouped feed restricted to the films their
 *  follows reach (NEU-1351). The response shape is `/feed/grouped`'s exactly, which is why the
 *  home page can render it through the same components as the global feed. */
export const fetchTimeline = ({ limit, offset }: { limit: number; offset: number }) =>
  apiFetch<FeedDayResponse>(`/me/timeline?limit=${limit}&offset=${offset}`);

/** The timeline page the home route swaps to once the account resolves as entitled.
 *
 *  `refetchOnMount: "always"` for the same reason the account query has it: the reader
 *  navigates away to a film page, follows somebody, and comes back, and the timeline they
 *  return to has to be the one that follow just changed. The follow mutations invalidate
 *  `timelineKey` too, which covers the case where they never leave the page. */
export function useTimeline({ limit, offset }: { limit: number; offset: number }) {
  const enabled = useFollowGraphEnabled();
  return useQuery({
    queryKey: timelinePageKey(limit, offset),
    queryFn: () => fetchTimeline({ limit, offset }),
    enabled,
    staleTime: 60_000,
    refetchOnMount: "always",
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
      // The one place the app learns a name for an entity id, whichever button was pressed:
      // `GET /me/follows` answers with ids alone, so without this the follows page has
      // nothing to call its rows (`lib/follow-labels.ts`). Written on follow rather than on
      // unfollow, and never removed, so re-following does not cost the name.
      if (!following) {
        rememberFollowLabel(
          target.entityType,
          target.entityId,
          target.label,
          target.imagePath ?? null,
        );
      }
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
    // The timeline is the feed filtered by exactly this list (D-11), so a follow that *lands*
    // changes which films belong on it. Invalidating every page of it rather than patching one
    // keeps the reader from having to guess why a newly followed director's day is missing.
    // On success only, unlike the follows list below: a failed follow is rolled back to the
    // graph the timeline was already built from, so re-reading it would fetch the same days.
    // The watchlist has no such line at all — it does not feed the timeline.
    onSuccess: () => qc.invalidateQueries({ queryKey: timelineKey }),
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

/** Change one item's alert preferences. The chips flip immediately and the refetch confirms;
 *  a failure puts the old set back, because a pref chip that silently stays on when the server
 *  rejected it is worse than one that visibly snaps back. */
export function useUpdateAlertPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ filmId, alertPrefs }: { filmId: string; alertPrefs: AlertPref[] }) =>
      updateAlertPrefs(filmId, alertPrefs),
    onMutate: async ({ filmId, alertPrefs }) => {
      await qc.cancelQueries({ queryKey: watchlistKey });
      const previous = qc
        .getQueryData<WatchlistListResponse>(watchlistKey)
        ?.items.find((item) => item.film.id === filmId)?.alert_prefs;
      qc.setQueryData<WatchlistListResponse>(watchlistKey, (old) => ({
        items: (old?.items ?? []).map((item) =>
          item.film.id === filmId ? { ...item, alert_prefs: alertPrefs } : item,
        ),
      }));
      return { previous };
    },
    onError: (error, { filmId }, context) => {
      if (context?.previous) {
        qc.setQueryData<WatchlistListResponse>(watchlistKey, (old) => ({
          items: (old?.items ?? []).map((item) =>
            item.film.id === filmId ? { ...item, alert_prefs: context.previous! } : item,
          ),
        }));
      }
      if (isEntitlementError(error)) {
        void refreshAccount(qc);
        return;
      }
      toast.error(error instanceof Error ? error.message : "Failed to update your alerts");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: watchlistKey }),
  });
}

// --- Settings (NEU-1382) ---

export const fetchSettings = () => apiFetch<UserSettings>("/me/settings");

/** PATCH takes the cadence alone — the backend's request model has one required field, and a
 *  PATCH with nothing in it is a client bug it refuses (NEU-1378). Answers with the whole row. */
export const updateDigestCadence = (digestCadence: DigestCadence) =>
  apiFetch<UserSettings>("/me/settings", {
    method: "PATCH",
    body: JSON.stringify({ digest_cadence: digestCadence }),
  });

/** The settings row, which the first read creates with its defaults (D-33). Gated on
 *  `entitled` like the follow graph: the route is subscriber-only (D-39) and an ungranted
 *  account would only ever get the 403. */
export function useSettings() {
  const enabled = useFollowGraphEnabled();
  return useQuery({
    queryKey: settingsKey,
    queryFn: fetchSettings,
    enabled,
    staleTime: 60_000,
  });
}

/** Change the digest cadence. Optimistic like the follow toggles: a radio that stays on the
 *  old option until the round trip returns reads as a click that did not take. The response
 *  is the row as saved, so it goes straight into the cache; a refusal puts the old row back. */
export function useUpdateDigestCadence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateDigestCadence,
    onMutate: async (digestCadence) => {
      await qc.cancelQueries({ queryKey: settingsKey });
      const previous = qc.getQueryData<UserSettings>(settingsKey);
      if (previous) qc.setQueryData(settingsKey, { ...previous, digest_cadence: digestCadence });
      return { previous };
    },
    onSuccess: (settings) => {
      qc.setQueryData(settingsKey, settings);
    },
    onError: (error, _cadence, context) => {
      if (context?.previous) qc.setQueryData(settingsKey, context.previous);
      if (isEntitlementError(error)) {
        void refreshAccount(qc);
        return;
      }
      toast.error("We could not save that. Please try again.");
    },
  });
}
