/**
 * The id of the last TMDB import this browser started (NEU-1359).
 *
 * Remembered here rather than read back from the API because there is no route that answers
 * "the latest TMDB import". `GET /me/import/{id}` is the only way to a job row (NEU-1357 §2),
 * and the one-shot design leaves nothing else behind to ask about: no `app.tmdb_link`, no
 * unlink route, no list endpoint. So the id is kept on the device that started the import and
 * the row is fetched by it.
 *
 * Consequence, accepted: the "Last imported from @user" line it feeds is per-browser. An import
 * run on a phone is not reported on a laptop, and clearing site data forgets it. What a forgotten
 * id costs is a sentence of provenance — the panel falls back to the same plain "Connect TMDB"
 * button a user who has never imported sees, so no action is ever out of reach because of it.
 *
 * That caveat covers the provenance line only. An *open* import — one still running or waiting
 * on its review list — is found cross-device through `GET /me/import/active` (NEU-1452), not
 * through this id; the line needs a *succeeded* job, which that route never answers with.
 */
const STORAGE_KEY = "backlotter.last-tmdb-import";

/** Optional-chained off `globalThis` rather than referenced directly: the store is absent
 *  under SSR and throws outright in a Safari private window, and neither is worth failing an
 *  import over. */
export function rememberTmdbImport(jobId: string): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, jobId);
  } catch {
    // Storage disabled or full. The panel loses its provenance line, nothing else.
  }
}

export function readTmdbImport(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}
