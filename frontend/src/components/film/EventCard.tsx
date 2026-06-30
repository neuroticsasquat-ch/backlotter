import { useState } from "react";
import { useRevalidator } from "react-router";
import { toast } from "sonner";
import type { FilmEvent } from "@/api/types";
import { useAuth } from "@/components/AuthContext";
import { deleteEvent, delinkSource } from "@/api/moderation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { eventTypeLabel } from "./labels";
import { SourceLinks } from "./SourceLinks";

export function EventCard({ event }: { event: FilmEvent }) {
  const { user } = useAuth();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const isAdmin = Boolean(user?.is_admin);

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

  return (
    <article>
      <p className="text-[15px] leading-relaxed text-foreground">
        <span className="mr-2 inline-block rounded bg-muted px-1.5 py-0.5 align-middle text-[11px] font-medium uppercase leading-none tracking-wide text-muted-foreground">
          {eventTypeLabel(event.event_type)}
        </span>
        {event.summary}
      </p>
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
        <div className="mt-1">
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
