import { useId, useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { MAX_UPLOAD_BYTES, useStartLetterboxdImport } from "@/api/imports";
import type { ImportJob } from "@/api/types";
import { Button } from "@/components/ui/button";
import { ImportProgress } from "./ImportProgress";
import { TmdbConnect } from "./TmdbConnect";

/** What the upload route accepts (NEU-1356 §1): the whole export zip, or either CSV out of it.
 *  Filtered here as well as on the picker's `accept`, because a drop bypasses `accept`
 *  entirely — a dragged folder or a PDF would otherwise be uploaded to be told it is a 422. */
const ACCEPTED_EXTENSIONS = [".zip", ".csv"];

const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(",");

const accepted = (file: File) =>
  ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));

/** The upload's failures, in the user's terms. The backend's `detail` strings are stable
 *  identifiers meant for a caller, not sentences meant for a reader, so each is answered here
 *  with what the user can actually do about it. */
function uploadMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409)
      return "One of your imports is still running. Wait for it to finish before starting another.";
    if (error.status === 413) return "That file is larger than 5 MB.";
    if (error.status === 422)
      return "We could not read that file. Upload the export zip Letterboxd sent you, or the watchlist.csv or ratings.csv inside it.";
    if (error.status === 403)
      return "Importing is part of the subscription, and your access has not been granted yet.";
    // The `import` bucket is six an hour per IP (NEU-1356 §4). Without this branch the fall
    // through below prints the backend's `rate_limited` identifier at the user.
    if (error.status === 429)
      return "You have started a few imports already. Try again in an hour.";
  }
  return error instanceof Error ? error.message : "The upload failed. Please try again.";
}

/**
 * Step 1 of `/welcome`: bring a library in, or don't.
 *
 * The upload answers 202 and the work happens in the background (D-15), so this step's job is
 * to hand the id upwards and then get out of the way — {@link ImportProgress} is rendered from
 * the flow above, which keeps polling after the user has moved on to step 2. Continuing while
 * an import runs is the expected path, not an escape hatch: a thousand-row library is minutes
 * of TMDB lookups and nobody should watch a bar for them.
 */
export function ImportStep({
  job,
  onStarted,
  onContinue,
  onSkip,
}: {
  job: ImportJob | null;
  onStarted: (jobId: string) => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = useStartLetterboxdImport();

  const upload = (file: File | undefined) => {
    if (!file) return;
    if (!accepted(file)) {
      setError("Upload the export zip Letterboxd sent you, or a .csv from inside it.");
      return;
    }
    // Checked before the request rather than after: the route caps the body at 5 MB, and
    // finding that out costs a 5 MB upload the user's connection has already paid for.
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("That file is larger than 5 MB.");
      return;
    }
    setError(null);
    start.mutate(file, {
      onSuccess: (started) => onStarted(started.job_id),
      onError: (err) => setError(uploadMessage(err)),
    });
  };

  return (
    <section aria-labelledby="import-step-heading">
      <h2 id="import-step-heading" className="text-xl font-semibold text-foreground">
        Bring your films with you
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Upload your Letterboxd export and we will follow the directors and cast of everything you
        rated four stars or higher, and put your watchlist on your watchlist. Nothing is guessed at
        — anything we cannot place we will show you.
      </p>

      <div
        // The drop target is a region rather than a button: the button inside it is what a
        // keyboard or a phone uses, and making the whole box clickable as well would give the
        // same control two focusable front doors.
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          upload(event.dataTransfer.files[0]);
        }}
        className={`mt-4 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          dragging ? "border-primary bg-primary/5" : "border-border bg-muted/20"
        }`}
      >
        <p className="text-sm text-foreground">Drop your Letterboxd export here</p>
        <p className="mt-1 text-xs text-muted-foreground">
          The .zip from Letterboxd&apos;s “Export your data”, or watchlist.csv / ratings.csv on its
          own. Up to 5 MB.
        </p>
        <label htmlFor={inputId} className="sr-only">
          Letterboxd export file
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ACCEPT_ATTR}
          className="sr-only"
          onChange={(event) => {
            upload(event.target.files?.[0]);
            // Cleared so re-picking the same file after a failure fires `change` again —
            // without this the second attempt at an identical path is silent.
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4"
          disabled={start.isPending}
          onClick={() => inputRef.current?.click()}
        >
          {start.isPending ? "Uploading…" : "Choose a file"}
        </Button>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {job && <ImportProgress job={job} />}

      <TmdbConnect job={job} />

      <div className="mt-6 flex items-center gap-4">
        <Button type="button" onClick={onContinue}>
          Continue
        </Button>
        <button
          type="button"
          onClick={onSkip}
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Skip this step
        </button>
      </div>
    </section>
  );
}
