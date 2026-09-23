import { useState } from "react";
import { TMDB_SOURCE, tmdbStartUrl, useImportJob } from "@/api/imports";
import type { ImportJob } from "@/api/types";
import { Button } from "@/components/ui/button";
import { formatEventDate } from "@/lib/format";
import { readTmdbImport } from "@/lib/tmdb-import";

/**
 * Connect a TMDB account, or reconnect one (NEU-1359).
 *
 * The control is an anchor, not a button with a handler, because what it does is leave: the
 * API answers the link with a 302 to themoviedb.org, where the user approves a request token
 * (NEU-1357 §2). A link is also what lets the browser do the ordinary things a browser does
 * with one — open it in a new tab, show where it goes — none of which a click handler offers.
 *
 * There is deliberately no "Unlink TMDB" here. The import is one-shot: the callback spends the
 * approved token, the job deletes the TMDB session as its last act, and nothing is stored
 * afterwards (D-16, NEU-1357 §4). There is no link to break, so the affordance that would have
 * broken it is replaced by what the user actually wants to know — that the import happened,
 * which account it read, and how to run it again.
 *
 * Mounted in `/welcome` step 1 today and built to be dropped into the settings page when that
 * page lands (NEU-1382). Note that the *return* leg is `/welcome` either way: `TMDB_REDIRECT_URL`
 * is one backend setting, so TMDB sends every approval back to the same page whichever one
 * started it.
 */
export function TmdbConnect({ job }: { job: ImportJob | null }) {
  // Read once, at mount. A TMDB import started in *this* session arrives as `job` instead, so
  // the stored id only ever has to answer for previous visits — which makes a lazy initializer
  // both correct and the only render-pure way to touch storage.
  const [rememberedId] = useState(readTmdbImport);
  const { data: remembered } = useImportJob(rememberedId);

  const latest = job?.source === TMDB_SOURCE ? job : remembered;
  // Only a finished import is worth reporting: a running one already has the progress panel
  // below saying so, and a failed one would put "imported from" over an import that produced
  // nothing. The username is the one thing kept about the account (D-16), so no username means
  // nothing to show even on a success.
  const previous =
    latest?.source === TMDB_SOURCE && latest.status === "succeeded" && latest.tmdb_username
      ? latest
      : null;

  return (
    <div className="mt-4 rounded-lg border border-border p-4">
      <p className="text-sm font-medium text-foreground">Import from TMDB instead</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Connect your TMDB account and we will follow everything on your TMDB watchlist, and the
        directors and cast of everything you have favourited. You approve it on TMDB — we never see
        your password, and we drop the connection as soon as the import is done.
      </p>

      {previous && (
        <p className="mt-2 text-xs text-muted-foreground">
          Last imported from{" "}
          <span className="font-medium text-foreground">@{previous.tmdb_username}</span>
          {previous.finished_at !== null && <> on {formatEventDate(previous.finished_at)}</>}.
        </p>
      )}

      <Button asChild type="button" variant="outline" size="sm" className="mt-3">
        <a href={tmdbStartUrl()}>{previous ? "Import again" : "Connect TMDB"}</a>
      </Button>
    </div>
  );
}
