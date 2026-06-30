import { apiFetch } from "./client";
import type { DelinkResponse } from "./types";

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
