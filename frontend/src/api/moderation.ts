import { apiFetch } from "./client";
import type { DelinkResponse, EditSummaryResponse } from "./types";

/** Delink one source story from an event (admin only). The story is rejected and detached;
 *  if that empties the event, the event is removed. Identified by the story's unique url. */
export function delinkSource(eventId: string, url: string): Promise<DelinkResponse> {
  return apiFetch<DelinkResponse>(`/admin/events/${encodeURIComponent(eventId)}/delink`, {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

/** Remove a whole event (admin only): reject all its source stories and delete the event. */
export function deleteEvent(eventId: string): Promise<DelinkResponse> {
  return apiFetch<DelinkResponse>(`/admin/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
  });
}

/** Edit an event's summary text (admin only). Freezes it against future AI regeneration. */
export function editSummary(eventId: string, summary: string): Promise<EditSummaryResponse> {
  return apiFetch<EditSummaryResponse>(`/admin/events/${encodeURIComponent(eventId)}/summary`, {
    method: "PATCH",
    body: JSON.stringify({ summary }),
  });
}

/** Reset an edited summary back to AI (admin only): deletes it so the next synthesize run
 *  regenerates it fresh. Only valid for currently-edited summaries. */
export function resetSummary(eventId: string): Promise<void> {
  return apiFetch<void>(`/admin/events/${encodeURIComponent(eventId)}/summary`, {
    method: "DELETE",
  });
}
