import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/components/AuthContext";
import { coveredBeyondTitleFollow, type FollowTarget } from "@/lib/film-entities";
import { ApiError, apiFetch } from "./client";
import {
  followsKey,
  settingsKey,
  timelineKey,
  timelinePageKey,
  watchlistCalendarPageKey,
  watchlistKey,
} from "./query-keys";
import type {
  AlertStore,
  CalendarResponse,
  DigestCadence,
  FeedDayResponse,
  Follow,
  FollowCoverage,
  FollowListResponse,
  UserSettings,
  WatchlistFilm,
  WatchlistItem,
  WatchlistListResponse,
} from "./types";

export const fetchFollows = () => apiFetch<FollowListResponse>("/me/follows");

export const fetchWatchlist = () => apiFetch<WatchlistListResponse>("/me/watchlist");

/** `coverage` is sent only when the caller chose one (the person page's control, which is
 *  visible before the follow exists — D-1416.8). Omitted, the backend applies `lead`, which is
 *  what every other follow button in the app wants; sending it explicitly on all of them would
 *  mean a 422 on the three entity types that refuse a coverage outright. */
export const createFollow = (target: FollowTarget, coverage?: FollowCoverage) =>
  apiFetch<Follow>("/me/follows", {
    method: "POST",
    body: JSON.stringify({
      entity_type: target.entityType,
      entity_id: target.entityId,
      ...(coverage ? { coverage } : {}),
    }),
  });

/** Narrow or widen what a person follow alerts on (D-43). The backend answers `422
 *  coverage_not_applicable` for any other entity type, which is why only person rows draw the
 *  control — the other three cover one thing each and have nothing to narrow. */
export const updateFollowCoverage = (
  target: { entityType: string; entityId: string },
  coverage: FollowCoverage,
) =>
  apiFetch<Follow>(`/me/follows/${target.entityType}/${encodeURIComponent(target.entityId)}`, {
    method: "PATCH",
    body: JSON.stringify({ coverage }),
  });

export const deleteFollow = (target: FollowTarget) =>
  apiFetch<void>(`/me/follows/${target.entityType}/${encodeURIComponent(target.entityId)}`, {
    method: "DELETE",
  });

/** *Want* this film (D-45): clear any mute, and create a manual title follow if nothing else
 *  covers it. Takes no preferences — the stores an availability alert is worth are one setting
 *  per account now ({@link updateAlertStores}), not a choice per film. */
export const addToWatchlist = (filmId: string) =>
  apiFetch<WatchlistItem>("/me/watchlist", {
    method: "POST",
    body: JSON.stringify({ film_id: filmId }),
  });

/** *Stop* hearing about the film (D-45): delete a direct title follow, and mute the film if
 *  another follow still covers it. Two answers, because there are two outcomes — `200` with the
 *  now-muted item while something still covers it, and `204` once nothing does and there is no
 *  item left to describe. `apiFetch` gives `undefined` for the `204`. */
export const removeFromWatchlist = (filmId: string) =>
  apiFetch<WatchlistItem | undefined>(`/me/watchlist/${encodeURIComponent(filmId)}`, {
    method: "DELETE",
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

/** One page of the reader's watchlist release calendar (NEU-1411): `GET /calendar`'s exact
 *  shape, narrowed to the films on their watchlist. `limit`/`offset` count distinct release
 *  dates rather than film rows, as the public route's do, so a page is a span of dates. */
export const fetchWatchlistCalendar = ({ limit, offset }: { limit: number; offset: number }) =>
  apiFetch<CalendarResponse>(`/me/calendar?limit=${limit}&offset=${offset}`);

/** The watchlist tab of `/calendar`, mounted once the account resolves as entitled.
 *
 *  `refetchOnMount: "always"` for the timeline's reason: the reader goes to a film page, adds
 *  it to their watchlist, comes back, and the calendar they return to has to show it. The
 *  watchlist mutations invalidate `watchlistKey`, a prefix of this key, which covers the case
 *  where they never leave the page. */
export function useWatchlistCalendar({ limit, offset }: { limit: number; offset: number }) {
  const enabled = useFollowGraphEnabled();
  return useQuery({
    queryKey: watchlistCalendarPageKey(limit, offset),
    queryFn: () => fetchWatchlistCalendar({ limit, offset }),
    enabled,
    staleTime: 60_000,
    refetchOnMount: "always",
  });
}

const sameEntity = (follow: Follow, target: FollowTarget) =>
  follow.entity_type === target.entityType && follow.entity_id === target.entityId;

const sameFollow = (a: Follow, b: Follow) =>
  a.entity_type === b.entity_type && a.entity_id === b.entity_id;

/** The user's follow of this target, or null. Read from the one cached list rather than a
 *  request per button — a film page carries a dozen of these. A caller that only wants the
 *  boolean should use {@link useIsFollowing}; this one is for the person page, which has to
 *  read the follow's `coverage` back into its control. */
export function useFollow(target: FollowTarget | null): Follow | null {
  const { data } = useFollows();
  if (!target) return null;
  return (data?.items ?? []).find((follow) => sameEntity(follow, target)) ?? null;
}

/** Whether the user already follows a target. */
export function useIsFollowing(target: FollowTarget | null): boolean {
  return useFollow(target) !== null;
}

/** The film's watchlist row, or null. The list carries muted films too (D-45), so a caller
 *  that wants "will I hear about this?" has to read {@link WatchlistItem.muted} rather than
 *  presence alone. */
export function useWatchlistItem(filmId: string | null): WatchlistItem | null {
  const { data } = useWatchlist();
  if (!filmId) return null;
  return (data?.items ?? []).find((item) => item.film.id === filmId) ?? null;
}

/** Follow or unfollow, applied to the cached list before the request goes out so the button
 *  flips under the user's finger. `following` is the state the target is in *now*, so the
 *  mutation moves it to the other one. */
export function useToggleFollow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      target,
      following,
      coverage,
    }: {
      target: FollowTarget;
      following: boolean;
      /** The tier to create the follow at, for a caller that offered the choice before the
       *  follow existed. Unfollowing ignores it. */
      coverage?: FollowCoverage;
    }) => {
      if (following) await deleteFollow(target);
      else await createFollow(target, coverage);
    },
    onMutate: async ({ target, following, coverage }) => {
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
          // The name and face the caller already had in hand, so a just-followed row does not
          // flash a placeholder for the length of the refetch. The server answers with the
          // catalog's own resolution a moment later (NEU-1396).
          name: target.label,
          image_path: target.imagePath ?? null,
          source: "manual",
          // What the POST asked for, or the default the backend applies to a follow created
          // without one (D-43).
          coverage: coverage ?? "lead",
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

/**
 * *Want* or *stop* the film (D-45), applied to the cached list before the request goes out so
 * the control flips under the user's finger.
 *
 * `onList` is the state the film is in *now* — heard about, or not — so the mutation moves it
 * to the other one. Neither direction is a plain insert or delete any more, because the
 * watchlist is computed: *want* on a muted row unmutes it rather than adding a second one, and
 * *stop* on a row something else still covers mutes it rather than removing it. The cache edit
 * mirrors what the backend will do, read from the item already in hand, so the row does not
 * jump when the refetch lands.
 */
export function useToggleWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ film, onList }: { film: WatchlistFilm; onList: boolean }) =>
      onList ? removeFromWatchlist(film.id) : addToWatchlist(film.id),
    onMutate: async ({ film, onList }) => {
      await qc.cancelQueries({ queryKey: watchlistKey });
      // Just this film's row, and where it sat, for the reason given in `useToggleFollow` —
      // and so a rollback puts it back in its place rather than at the end of a list the
      // server orders by `created_at`.
      const items = qc.getQueryData<WatchlistListResponse>(watchlistKey)?.items ?? [];
      const index = items.findIndex((item) => item.film.id === film.id);
      const previous = index === -1 ? undefined : items[index];
      qc.setQueryData<WatchlistListResponse>(watchlistKey, (old) => {
        const items = old?.items ?? [];
        if (onList) {
          // Something other than the film's own title follow covers it, so stopping leaves it
          // on the list, muted — and no longer directly followed, since that follow is what
          // the DELETE removes.
          if (previous && coveredBeyondTitleFollow(previous.covered_by, film.id)) {
            return {
              items: items.map((item) =>
                item.film.id === film.id ? { ...item, muted: true, followed: false } : item,
              ),
            };
          }
          return { items: items.filter((item) => item.film.id !== film.id) };
        }
        // Wanting a muted film unmutes it in place; the mute is the only thing that was
        // keeping it quiet, and its covers are unchanged.
        if (previous) {
          return {
            items: items.map((item) =>
              item.film.id === film.id ? { ...item, muted: false } : item,
            ),
          };
        }
        const optimistic: WatchlistItem = {
          film,
          // The title follow the POST is about to create. The refetch replaces this with the
          // server's `covered_by`, which also names anything else that reaches the film.
          covered_by: [{ entity_type: "title", entity_id: film.id, name: film.title }],
          followed: true,
          muted: false,
          created_at: new Date().toISOString(),
        };
        return { items: [...items, optimistic] };
      });
      return { previous, index };
    },
    // The server's answer is authoritative, and the optimistic edit above is a *guess*: it
    // reads the covers from the cached row, which a surface that never loaded the list does
    // not have. `undefined` is the `204` — nothing covers the film any more, so the row is
    // gone; an item is the row as saved, muted or not.
    onSuccess: (item, { film }) => {
      qc.setQueryData<WatchlistListResponse>(watchlistKey, (old) => {
        const items = (old?.items ?? []).filter((row) => row.film.id !== film.id);
        return { items: item ? [...items, item] : items };
      });
      // A title follow changes what the timeline shows, which the old watchlist toggle never
      // did — and a mute silences the film there too (D-45). On success only: a rolled-back
      // toggle left the follow graph the timeline was already built from.
      void qc.invalidateQueries({ queryKey: timelineKey });
    },
    onError: (error, { film }, context) => {
      // Restore the row exactly as it was — muted flag, covers, position and all — rather than
      // guessing at an inverse, because neither edit above is a simple one.
      qc.setQueryData<WatchlistListResponse>(watchlistKey, (old) => {
        const items = (old?.items ?? []).filter((item) => item.film.id !== film.id);
        if (!context?.previous) return { items };
        items.splice(context.index, 0, context.previous);
        return { items };
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

/** Change one person follow's coverage (D-43). Optimistic like the toggles beside it: a radio
 *  that stays on the old tier until the round trip returns reads as a click that did not take.
 *  The watchlist is computed from coverage, so a change that lands re-reads it. */
export function useUpdateFollowCoverage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ follow, coverage }: { follow: Follow; coverage: FollowCoverage }) =>
      updateFollowCoverage(
        { entityType: follow.entity_type, entityId: follow.entity_id },
        coverage,
      ),
    onMutate: async ({ follow, coverage }) => {
      await qc.cancelQueries({ queryKey: followsKey });
      const previous = qc
        .getQueryData<FollowListResponse>(followsKey)
        ?.items.find((f) => sameFollow(f, follow))?.coverage;
      qc.setQueryData<FollowListResponse>(followsKey, (old) => ({
        items: (old?.items ?? []).map((f) => (sameFollow(f, follow) ? { ...f, coverage } : f)),
      }));
      return { previous };
    },
    onError: (error, { follow }, context) => {
      if (context?.previous) {
        qc.setQueryData<FollowListResponse>(followsKey, (old) => ({
          items: (old?.items ?? []).map((f) =>
            sameFollow(f, follow) ? { ...f, coverage: context.previous! } : f,
          ),
        }));
      }
      if (isEntitlementError(error)) {
        void refreshAccount(qc);
        return;
      }
      toast.error("We could not change what that follow alerts you about. Please try again.");
    },
    // Coverage narrows alerts, and the watchlist *is* the set of films covered for alerts —
    // so widening or narrowing one follow changes which films are on it. The timeline moves
    // too, but only across the `any` boundary (D-47): `lead` and `major` are both subsets of
    // the seed grade the timeline has always shown, and `any` widens it to every credit.
    // Invalidated unconditionally rather than on that boundary, because "which of the two
    // tiers we just left" is a rule the server owns and a client copy of it would rot.
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: watchlistKey }),
        qc.invalidateQueries({ queryKey: timelineKey }),
      ]),
    onSettled: () => qc.invalidateQueries({ queryKey: followsKey }),
  });
}

// --- Settings (NEU-1382) ---

export const fetchSettings = () => apiFetch<UserSettings>("/me/settings");

/** PATCH takes the cadence alone — the backend's request model needs *one* of its fields, not
 *  all of them, so the screen writes the control the user touched rather than restating the
 *  row (NEU-1378). Answers with the whole row. */
export const updateDigestCadence = (digestCadence: DigestCadence) =>
  apiFetch<UserSettings>("/me/settings", {
    method: "PATCH",
    body: JSON.stringify({ digest_cadence: digestCadence }),
  });

/** Replace the account's store set (D-44). The whole set, not a delta — `[]` is "no store
 *  alerts", a real choice and distinct from the `{stream}` default a row is created with. The
 *  backend canonicalises the order, so the list sent here need not be sorted. */
export const updateAlertStores = (alertStores: AlertStore[]) =>
  apiFetch<UserSettings>("/me/settings", {
    method: "PATCH",
    body: JSON.stringify({ alert_stores: alertStores }),
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

/** Issue a new calendar token (D-34). A POST rather than a PATCH because the caller does not
 *  choose the new value; it answers with the whole settings row, so the calendar panel redraws
 *  from one response. */
export const rotateIcalToken = () =>
  apiFetch<UserSettings>("/me/settings/ical-token/rotate", { method: "POST" });

/** Rotate the calendar token. Deliberately *not* optimistic, unlike the cadence beside it:
 *  there is no next value to render until the server has picked one, and a URL that flickered
 *  to a guess would be a URL somebody could copy and subscribe to. The row the rotate answers
 *  with is authoritative, so it goes straight into the cache and every old subscription is
 *  dead from that moment. */
export function useRotateIcalToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rotateIcalToken,
    onSuccess: (settings) => {
      qc.setQueryData(settingsKey, settings);
    },
    onError: (error) => {
      if (isEntitlementError(error)) {
        void refreshAccount(qc);
        return;
      }
      toast.error("We could not change your calendar link. Please try again.");
    },
  });
}

/** Change which stores an availability alert is worth (D-44). Optimistic on the cadence's
 *  terms below, and for the same reason: a chip that stays on the old setting until the round
 *  trip returns reads as a click that did not take. */
export function useUpdateAlertStores() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateAlertStores,
    onMutate: async (alertStores) => {
      await qc.cancelQueries({ queryKey: settingsKey });
      const previous = qc.getQueryData<UserSettings>(settingsKey);
      if (previous) qc.setQueryData(settingsKey, { ...previous, alert_stores: alertStores });
      return { previous };
    },
    onSuccess: (settings) => {
      qc.setQueryData(settingsKey, settings);
    },
    onError: (error, _stores, context) => {
      if (context?.previous) qc.setQueryData(settingsKey, context.previous);
      if (isEntitlementError(error)) {
        void refreshAccount(qc);
        return;
      }
      toast.error("We could not save that. Please try again.");
    },
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
