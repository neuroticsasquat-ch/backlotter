import { useId, useState, type FormEvent } from "react";
import { useCreateInvite, useInvites } from "@/api/invites";
import type { Invite } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatEventDate } from "@/lib/format";
import { inviteSignupUrl } from "@/lib/invite-url";

function ForCell({ invite }: { invite: Invite }) {
  return invite.email_hint ?? <span className="text-muted-foreground">Anyone</span>;
}

function MintForm() {
  const inputId = useId();
  const helpId = useId();
  const [email, setEmail] = useState("");
  const create = useCreateInvite();

  function submit(e: FormEvent) {
    e.preventDefault();
    const hint = email.trim();
    create.mutate(
      { emailHint: hint === "" ? null : hint },
      // Cleared on success only: a refused address stays in the field to be fixed.
      { onSuccess: () => setEmail("") },
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-wrap items-end gap-2">
      <div>
        <Label htmlFor={inputId}>Email (optional)</Label>
        <Input
          id={inputId}
          type="email"
          // The backend caps an address at 320; a longer one is a 422, not a hinted code.
          maxLength={320}
          value={email}
          disabled={create.isPending}
          onChange={(e) => setEmail(e.target.value)}
          aria-describedby={helpId}
          className="mt-1 w-72"
          autoComplete="off"
        />
        <p id={helpId} className="mt-1 text-xs text-muted-foreground">
          A code with an email can only be spent by that address.
        </p>
      </div>
      <Button type="submit" disabled={create.isPending} className="mb-5">
        Mint invite
      </Button>
    </form>
  );
}

/** The one Copy control per outstanding row. Tracks *which* code was copied rather than a
 *  boolean, so only that row reads "Copied." — mirrors `Settings.tsx`'s calendar link. */
function CopyLink({
  invite,
  copiedCode,
  onCopied,
  onFailed,
}: {
  invite: Invite;
  copiedCode: string | null;
  onCopied: (code: string) => void;
  onFailed: (code: string) => void;
}) {
  const url = inviteSignupUrl(invite, window.location.origin);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      onCopied(invite.code);
    } catch {
      // No clipboard access (an insecure origin, or a browser that asks and was refused). Show
      // the URL in a field the admin can select, and say so, rather than fail silently.
      onFailed(invite.code);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={`Copy link for ${invite.code}`}
        onClick={copy}
      >
        Copy link
      </Button>
      <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {copiedCode === invite.code ? "Copied." : ""}
      </span>
    </div>
  );
}

export function AdminInvites() {
  const { data, isLoading, isError, error } = useInvites();
  // Which code's link was copied last; a second row's copy moves the "Copied." to it.
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  // Which code's copy was refused by the clipboard, if any; that row shows its URL instead.
  const [failedCode, setFailedCode] = useState<string | null>(null);

  const invites = data ?? [];
  const outstanding = invites.filter((i) => i.consumed_at === null);
  const used = invites
    .filter((i): i is Invite & { consumed_at: string } => i.consumed_at !== null)
    .sort((a, b) => Date.parse(b.consumed_at) - Date.parse(a.consumed_at));

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold">Invites</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Signup is invite-only until subscriptions launch. Mint a code, copy its link, and send it
        yourself — nothing is emailed from here. An invite gets someone an account; access is still
        granted separately on the Users page.
      </p>

      <MintForm />

      {isLoading && <p className="mt-6 text-muted-foreground">Loading invites…</p>}

      {isError && (
        <p className="mt-6 text-red-600">
          Failed to load invites{error instanceof Error ? `: ${error.message}` : ""}.
        </p>
      )}

      {data && (
        <>
          <section aria-labelledby="outstanding-heading" className="mt-8">
            <h2 id="outstanding-heading" className="text-lg font-semibold">
              Outstanding
            </h2>
            {outstanding.length === 0 ? (
              <p className="mt-2 text-muted-foreground">No outstanding invites.</p>
            ) : (
              <table className="mt-2 w-full text-left text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-2 pr-4 font-medium">Code</th>
                    <th className="py-2 pr-4 font-medium">For</th>
                    <th className="py-2 pr-4 font-medium">Created</th>
                    <th className="py-2 font-medium">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {outstanding.map((invite) => (
                    <tr key={invite.code} className="border-b align-top">
                      <td className="py-2 pr-4 font-mono">{invite.code}</td>
                      <td className="py-2 pr-4">
                        <ForCell invite={invite} />
                      </td>
                      <td className="py-2 pr-4">{formatEventDate(invite.created_at)}</td>
                      <td className="py-2">
                        <CopyLink
                          invite={invite}
                          copiedCode={copiedCode}
                          onCopied={(code) => {
                            setCopiedCode(code);
                            setFailedCode(null);
                          }}
                          onFailed={(code) => {
                            setCopiedCode(null);
                            setFailedCode(code);
                          }}
                        />
                        {failedCode === invite.code && (
                          <div className="mt-2">
                            <Input
                              readOnly
                              aria-label={`Link for ${invite.code}`}
                              value={inviteSignupUrl(invite, window.location.origin)}
                              className="font-mono text-xs"
                            />
                            <p role="alert" className="mt-1 text-xs text-red-600">
                              We could not reach your clipboard. Select the link and copy it
                              yourself.
                            </p>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section aria-labelledby="used-heading" className="mt-8">
            <h2 id="used-heading" className="text-lg font-semibold">
              Used
            </h2>
            {used.length === 0 ? (
              <p className="mt-2 text-muted-foreground">No invites have been used yet.</p>
            ) : (
              <table className="mt-2 w-full text-left text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-2 pr-4 font-medium">Code</th>
                    <th className="py-2 pr-4 font-medium">For</th>
                    <th className="py-2 pr-4 font-medium">Used</th>
                    <th className="py-2 font-medium">By</th>
                  </tr>
                </thead>
                <tbody>
                  {used.map((invite) => (
                    <tr key={invite.code} className="border-b align-top">
                      <td className="py-2 pr-4 font-mono">{invite.code}</td>
                      <td className="py-2 pr-4">
                        <ForCell invite={invite} />
                      </td>
                      <td className="py-2 pr-4">{formatEventDate(invite.consumed_at)}</td>
                      <td className="py-2">
                        {invite.consumed_by_email ?? (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default AdminInvites;
