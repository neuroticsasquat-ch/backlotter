import { useState } from "react";
import { useRevalidator } from "react-router";
import { toast } from "sonner";
import type { FilmEvent } from "@/api/types";
import { useAuth } from "@/components/AuthContext";
import { deleteEvent, delinkSource, editSummary, resetSummary } from "@/api/moderation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { dayKey, formatEventDate } from "@/lib/format";
import { RETRACTED_LABEL, confidenceLabel, eventAnchorId, eventTypeLabel } from "./labels";
import { SourceLinks } from "./SourceLinks";
import { EditSummaryDialog } from "./EditSummaryDialog";

const PILL =
  "inline-block rounded px-1.5 py-0.5 align-middle text-[11px] font-medium uppercase leading-none tracking-wide";

const CONFIDENCE_PILL = {
  confirmed: "bg-muted text-muted-foreground",
  unconfirmed: "bg-amber-100 text-amber-800",
} as const;

/** One event on the film page's timeline.
 *  `day` is the "YYYY-MM-DD" heading the card sits under. When the beat's `occurred_at` falls
 *  outside it the card discloses "first seen <date>" (D-9, the ADR-0016 residual) — a backdated
 *  beat otherwise carries no hint of the gap. Omitted, nothing is disclosed. */
export function EventCard({ event, day }: { event: FilmEvent; day?: string }) {
  const { user } = useAuth();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [summaryOverride, setSummaryOverride] = useState<string | null>(null);
  const isAdmin = Boolean(user?.is_admin);
  const displaySummary = summaryOverride ?? event.summary;
  const isEdited = event.summary_edited || summaryOverride !== null;
  const confidence = confidenceLabel(event.confidence);
  const showFirstSeen = day !== undefined && dayKey(event.occurred_at) !== day;

  async function run(action: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await action();
      toast.success(ok);
      revalidator.revalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleEditSave(text: string) {
    await editSummary(event.event_id, text);
    toast.success("Summary updated");
    setSummaryOverride(text);
    revalidator.revalidate();
  }

  return (
    <article id={eventAnchorId(event.event_id)}>
      <p className="text-[15px] leading-relaxed text-foreground">
        <span className={`mr-2 bg-muted text-muted-foreground ${PILL}`}>
          {eventTypeLabel(event.event_type)}
        </span>
        <span className={`mr-2 ${CONFIDENCE_PILL[confidence]} ${PILL}`}>{confidence}</span>
        {displaySummary}
        {isEdited ? (
          <span className={`ml-2 bg-muted text-muted-foreground ${PILL}`}>edited</span>
        ) : null}
        {event.status === "superseded" ? (
          event.superseded_by ? (
            <a
              href={`#${eventAnchorId(event.superseded_by)}`}
              className="ml-2 text-xs italic text-muted-foreground underline-offset-2 hover:underline"
            >
              {RETRACTED_LABEL}
            </a>
          ) : (
            <span className="ml-2 text-xs italic text-muted-foreground">{RETRACTED_LABEL}</span>
          )
        ) : null}
      </p>
      {showFirstSeen ? (
        <p className="mt-0.5 text-xs text-muted-foreground">
          first seen <time dateTime={event.occurred_at}>{formatEventDate(event.occurred_at)}</time>
        </p>
      ) : null}
      <SourceLinks
        sources={event.sources}
        admin={isAdmin}
        busy={busy}
        onDelink={
          isAdmin
            ? (url) => run(() => delinkSource(event.event_id, url), "Source delinked")
            : undefined
        }
      />
      {isAdmin ? (
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <EditSummaryDialog
            initialValue={displaySummary}
            onSave={handleEditSave}
            trigger={
              <button
                type="button"
                disabled={busy}
                className="text-xs text-muted-foreground hover:text-blue-500 disabled:opacity-50"
              >
                Edit
              </button>
            }
          />
          {isEdited ? (
            <ConfirmDialog
              title="Reset to AI summary?"
              description="This deletes the current edited summary and re-queues it for AI regeneration on the next synthesize run. The event drops off the page until it's regenerated."
              confirmLabel="Reset to AI"
              onConfirm={() =>
                run(
                  () => resetSummary(event.event_id),
                  "Reset queued — will regenerate on the next run",
                )
              }
              trigger={
                <button
                  type="button"
                  disabled={busy}
                  className="text-xs text-muted-foreground hover:text-red-500 disabled:opacity-50"
                >
                  Reset to AI
                </button>
              }
            />
          ) : null}
          <ConfirmDialog
            title="Remove this event?"
            description={`This rejects all ${event.sources.length} source(s) and deletes the event.`}
            confirmLabel="Remove event"
            onConfirm={() => run(() => deleteEvent(event.event_id), "Event removed")}
            trigger={
              <button
                type="button"
                disabled={busy}
                className="text-xs text-muted-foreground hover:text-red-500 disabled:opacity-50"
              >
                Remove event
              </button>
            }
          />
        </div>
      ) : null}
    </article>
  );
}
