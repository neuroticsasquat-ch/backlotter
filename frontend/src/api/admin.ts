import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiFetch, apiFetchText } from "./client";
import type { DigestCadence } from "./types";

/** A cadence a digest can be rendered on: the setting's values less `off`, which is the
 *  absence of a mail rather than a kind of one. The admin page renders either for anyone,
 *  whichever they are set to. */
export type RenderableCadence = Exclude<DigestCadence, "off">;

/** Which part of the mail to render: the HTML body or its plain-text alternative. */
export type DigestFormat = "html" | "text";

/** Today's date in UTC as `YYYY-MM-DD` — the day the backend defaults `today` to, and the
 *  date field's starting value. UTC rather than local so the page and the slot agree on
 *  which day it is. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** The digest `userId` would receive on `cadence` as of `today`, as the raw HTML or text part.
 *  Marks nothing and ignores the entitlement gate, so a lapsed user previews too (DC-11). */
export function previewDigest(
  userId: string,
  cadence: RenderableCadence,
  format: DigestFormat,
  today: string,
) {
  const params = new URLSearchParams({ user_id: userId, cadence, format, today });
  return apiFetchText(`/admin/digest/preview?${params}`);
}

/** Mail the same digest to the calling admin — never to the user — and answer the provider's
 *  message id. `409 nothing_to_send` when the preview would read "Nothing to send.", `502
 *  mail_failed` when the provider refuses. */
export const sendTestDigest = (userId: string, cadence: RenderableCadence, today: string) =>
  apiFetch<{ message_id: string }>("/admin/digest/test", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, cadence, today }),
  });

/** A 4xx from the preview is the request's own fault — an unknown user, a bad date — and
 *  asking again returns the same answer, so only a server or network failure is retried. */
function retryUnlessClientError(failureCount: number, error: Error) {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < 3;
}

/** The preview for one picked user, cadence, format and date; idle until a user is picked. */
export function useDigestPreview(
  userId: string | null,
  cadence: RenderableCadence,
  format: DigestFormat,
  today: string,
) {
  return useQuery({
    queryKey: ["admin-digest-preview", { userId, cadence, format, today }],
    queryFn: () => previewDigest(userId!, cadence, format, today),
    enabled: userId !== null && today !== "",
    retry: retryUnlessClientError,
  });
}

/** The refusals the test send can answer with, said the way the admin needs to hear them. */
export function testSendErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return "Nothing to send — no test mail went out.";
    if (err.status === 502) return "The mail provider refused the test send.";
    if (err.status === 404) return "No account with that id.";
  }
  return err instanceof Error ? err.message : "Failed to send the test digest";
}

export function useSendTestDigest() {
  return useMutation({
    mutationFn: ({
      userId,
      cadence,
      today,
    }: {
      userId: string;
      cadence: RenderableCadence;
      today: string;
    }) => sendTestDigest(userId, cadence, today),
    onSuccess: ({ message_id }) => {
      toast.success(`Test digest sent — message id ${message_id}`);
    },
    onError: (err) => {
      toast.error(testSendErrorMessage(err));
    },
  });
}
