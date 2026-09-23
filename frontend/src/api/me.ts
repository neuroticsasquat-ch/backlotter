import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/components/AuthContext";
import type { FollowTarget } from "@/lib/film-entities";
import { ApiError, apiFetch } from "./client";
import {
  followsKey,
  myFilmsCalendarPageKey,
  settingsKey,
  timelineKey,
  timelinePageKey,
} from "./query-keys";
import type {
  AlertStore,
  CalendarResponse,
  DigestCadence,
  FeedDayResponse,
  Follow,
  FollowListResponse,
  UserSettings,
} from "./types";

export const fetchFollows = () => apiFetch<FollowListResponse>("/me/follows");

/** The whole body: a follow is binary now (EF-1), so what to follow is all there is to say.
 *  The `coverage` tier this used to carry is gone, and with it the PATCH that changed one — a
 *  follow has no mutable field left, so there is nothing to update, only to create or delete. */
export const createFollow = (target: FollowTarget) =>
  apiFetch<Follow>("/me/follows", {
    method: "POST",
    body: JSON.stringify({ entity_type: target.entityType, entity_id: target.entityId }),
  });

export const deleteFollow = (target: FollowTarget) =>
  apiFetch<void>(`/me/follows/${target.entityType}/${encodeURIComponent(target.entityId)}`, {
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
 *  the page into its locked state. `exact` so the follow list below, which is about to be
 *  refetched by its own mutation, is not invalidated twice. */
const refreshAccount = (qc: QueryClient) => qc.invalidateQueries({ queryKey: ["me"], exact: true });

/** Whether the signed-in account may read the follow graph at all. It is subscriber-only, so
 *  an unentitled account would only ever get the 403 above, and a signed-out one a 401 —
 *  neither is worth a request. Under SSR the account query never resolves, so this is false
 *  there and the server render fetches nothing. */
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

/** One page of the reader's **My films** release calendar (NEU-1411, EF-14): `GET /calendar`'s
 *  exact shape, narrowed to the films they follow. `limit`/`offset` count distinct release
 *  dates rather than film rows, as the public route's do, so a page is a span of dates. */
export const fetchMyFilmsCalendar = ({ limit, offset }: { limit: number; offset: number }) =>
  apiFetch<CalendarResponse>(`/me/calendar?limit=${limit}&offset=${offset}`);

/** The **My films** tab of `/calendar`, mounted once the account resolves as entitled.
 *
 *  `refetchOnMount: "always"` for the timeline's reason: the reader goes to a film page,
 *  follows it, comes back, and the calendar they return to has to show it. The follow
 *  mutations invalidate `followsKey`, a prefix of this key, which covers the case where they
 *  never leave the page. */
export function useMyFilmsCalendar({ limit, offset }: { limit: number; offset: number }) {
  const enabled = useFollowGraphEnabled();
  return useQuery({
    queryKey: myFilmsCalendarPageKey(limit, offset),
    queryFn: () => fetchMyFilmsCalendar({ limit, offset }),
    enabled,
    staleTime: 60_000,
    refetchOnMount: "always",
  });
}

const sameEntity = (follow: Follow, target: FollowTarget) =>
  follow.entity_type === target.entityType && follow.entity_id === target.entityId;

/** The user's follow of this target, or null. Read from the one cached list rather than a
 *  request per button — a film page carries a dozen of these. Most callers only want the
 *  boolean and should use {@link useIsFollowing}; this one is for a caller that needs the row
 *  itself. */
export function useFollow(target: FollowTarget | null): Follow | null {
  const { data } = useFollows();
  if (!target) return null;
  return (data?.items ?? []).find((follow) => sameEntity(follow, target)) ?? null;
}

/** Whether the user already follows a target. */
export function useIsFollowing(target: FollowTarget | null): boolean {
  return useFollow(target) !== null;
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
          // The name and face the caller already had in hand, so a just-followed row does not
          // flash a placeholder for the length of the refetch. The server answers with the
          // catalog's own resolution a moment later (NEU-1396).
          name: target.label,
          image_path: target.imagePath ?? null,
          source: "manual",
          // Nothing has happened through a follow made a moment ago, and a brand new follow
          // has no date of its own to lead with. Both are the honest nulls, and both are
          // replaced by the server's own answer on the refetch.
          headline_release: null,
          created_at: new Date().toISOString(),
          last_activity_at: null,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: timelineKey }),
    // The My films calendar needs no line of its own: its key sits *under* `followsKey`, so
    // this one invalidation reaches it too, and a film followed from its page is on the
    // calendar when the reader goes back to it (EF-14).
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
