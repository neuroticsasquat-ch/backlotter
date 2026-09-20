import type { Invite } from "@/api/types";

/**
 * The signup link an admin hands out for one invite (NEU-1408, D-1408.4).
 *
 * `Signup.tsx` already reads `?invite=` (opens the code field, prefilled) and `?email=`
 * (prefills the address), so the link is that page on this site's origin with both set — the
 * email only when the code is hinted, since an unhinted code is spendable by anyone.
 *
 * The origin is a parameter rather than `window.location.origin` read here, so the helper is
 * testable without a DOM; the one caller passes the page's own origin. Values go through
 * `URLSearchParams`, so a `+` in an address survives the round trip instead of arriving as a
 * space.
 */
export function inviteSignupUrl(invite: Invite, origin: string): string {
  const params = new URLSearchParams({ invite: invite.code });
  if (invite.email_hint !== null) params.set("email", invite.email_hint);
  return `${origin.replace(/\/$/, "")}/signup?${params}`;
}
