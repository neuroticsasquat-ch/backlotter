/** The cache keys for the account-scoped collections, kept in one module because two of the
 *  three have writers on both sides of the `AuthContext` ↔ `api/me` import edge: the hooks in
 *  `api/me.ts` read `useAuth`, so `AuthContext` cannot import a key back from there without
 *  closing the cycle. Spelling a key inline at a call site instead is a cache nothing
 *  invalidates, so every caller takes it from here.
 *
 *  `followsKey` and `watchlistKey` sit under `["me"]`, the account query's own key, so
 *  `AuthContext.refresh()` — which invalidates that prefix — refreshes the follow graph
 *  alongside the account it belongs to. `timelineKey` deliberately does not: the timeline is a
 *  page of the feed rather than a property of the account, it is paged (so its keys carry a
 *  limit and an offset), and a re-read of `/me` should not throw away pages the reader has
 *  already asked for. It is invalidated explicitly, by the follow mutations and by logout.
 */
export const followsKey = ["me", "follows"] as const;
export const watchlistKey = ["me", "watchlist"] as const;
/** Under `["me"]` with the two collections: the settings row is subscriber-only (D-39), so a
 *  refresh of the account — which is what flips `entitled` — is exactly when it needs
 *  re-reading. */
export const settingsKey = ["me", "settings"] as const;
export const timelineKey = ["timeline"] as const;

/** The key for one page of `GET /me/timeline`. Every page shares the `timelineKey` prefix, so
 *  invalidating that one key refreshes all of them. */
export const timelinePageKey = (limit: number, offset: number) =>
  [...timelineKey, limit, offset] as const;

/** One import job's poll key (NEU-1356). Outside the `["me"]` prefix deliberately: a job is a
 *  one-off piece of work with its own lifecycle, and a refresh of the account — which the
 *  import itself triggers when it finishes — must not cancel or restart the poll that is
 *  watching it. */
export const importJobKey = (jobId: string) => ["import-job", jobId] as const;

/** The reader's watchlist calendar (NEU-1412). Under `watchlistKey`, not beside `timelineKey`:
 *  the watchlist calendar is a *view of the watchlist*, so adding or removing a film — which
 *  already invalidates the `["me","watchlist"]` prefix in `useToggleWatchlist` — must refresh
 *  it without any new wiring, and a re-read of the account, which is what flips `entitled`,
 *  drops it with the collection it belongs to.
 *
 *  The timeline's reasoning about paged keys does not carry over: it is invalidated by *follow*
 *  mutations, which have no natural prefix over it, whereas this has one already. */
export const watchlistCalendarKey = [...watchlistKey, "calendar"] as const;

/** The key for one page of `GET /me/calendar`. `limit`/`offset` count distinct release dates,
 *  as the public route's do (NEU-1411). */
export const watchlistCalendarPageKey = (limit: number, offset: number) =>
  [...watchlistCalendarKey, limit, offset] as const;
