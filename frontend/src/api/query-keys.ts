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
export const timelineKey = ["timeline"] as const;

/** The key for one page of `GET /me/timeline`. Every page shares the `timelineKey` prefix, so
 *  invalidating that one key refreshes all of them. */
export const timelinePageKey = (limit: number, offset: number) =>
  [...timelineKey, limit, offset] as const;
