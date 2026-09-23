import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch } from "./client";
import type { Invite } from "./types";

export const INVITES_QUERY_KEY = ["admin-invites"] as const;

/** Every invite ever issued, newest first. Unpaged on the backend, and so here. */
export const fetchInvites = () => apiFetch<Invite[]>("/admin/invites");

/** Mint one code. An `emailHint` binds the code to that address — nobody else can spend it —
 *  and is omitted from the body rather than sent empty, because the backend validates any
 *  hint it is given as an email address. Sends nothing: the admin copies the link. */
export const createInvite = (emailHint: string | null) =>
  apiFetch<Invite>("/admin/invites", {
    method: "POST",
    body: JSON.stringify(emailHint ? { email_hint: emailHint } : {}),
  });

export function useInvites() {
  return useQuery({ queryKey: INVITES_QUERY_KEY, queryFn: fetchInvites });
}

/** Mint a code and put the reply at the top of the cached list, the way the users page writes
 *  a grant back — the POST answers with the row, so there is nothing to refetch. */
export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ emailHint }: { emailHint: string | null }) => createInvite(emailHint),
    onSuccess: (created) => {
      qc.setQueryData<Invite[]>(INVITES_QUERY_KEY, (old) => [created, ...(old ?? [])]);
      toast.success("Invite minted");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to mint invite");
    },
  });
}
