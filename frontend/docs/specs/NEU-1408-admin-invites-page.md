# NEU-1408 — Admin invites page, and close public signup until subscriptions launch

**Ticket:** [NEU-1408](https://linear.app/neuroticsasquatch/issue/NEU-1408/admin-invites-page-and-close-public-signup-until-subscriptions-launch)
**Project:** bl: Consumer Pivot (no milestone) · **Related:** NEU-1409 (front-page subscription offer; will add the public Sign up entry point once there is something to buy)
**Decisions honoured:** D-18 (open signup and its rollback), D-37/D-38 (entitlement is a separate grant), M1 shared contract "Admin surface: session-authed `require_current_admin`, not the `ADMIN_TOKEN` routers" (`../backend/docs/specs/bl-consumer-pivot-project-spec.md` §5, table row *Admin surface*)
**Target repos:** upcoming-movies-backend **first**, then upcoming-movies-frontend · **Base branch:** `release/v1.0.0` in both (AGENTS.md `loop_base`)
**Blocked by:** nothing · **Blocks:** nothing

## What to build and why

Public signup must not stay open until subscriptions exist. The machinery is already there:
`SIGNUP_OPEN=false` (`config.py`, default `true`) makes `POST /auth/signup` require an invite
code while Turnstile stays on, `POST /admin/invites` mints codes with an optional `email_hint`,
`GET /admin/invites` lists them newest first, and `pages/Signup.tsx` already reads `?invite=`
and `?email=` from the query string, opens the code field for a comped link, and answers the
403 `invalid_invite` with the right copy in both the "no code" and "bad code" cases.

What is missing is a way for an admin to mint and hand out a code without curl. `ADMIN_NAV_ITEMS`
has Ingestion / Sources / Users / Resolution and no Invites.

**The ticket's "nothing new on the backend" premise is wrong.** `routers/invites_admin.py` is
gated by `require_admin`, the bearer `ADMIN_TOKEN` header. Every admin page the SPA talks to
(`/admin/users`, `/admin/runs`, `/admin/sources`, `/admin/resolution`, `/admin/credit-holds`)
sits behind `require_current_admin` (session cookie + `is_admin`) with `require_csrf` on writes,
because `apiFetch` sends cookies and the CSRF header and has no way to send a bearer token. So the
page cannot exist without a backend change, and this is a two-repo ticket. Nothing but the
router's own test file calls the token-gated route today (grep of both repos), so flipping it
breaks no caller.

## Key decisions

### D-1408.1 — `/admin/invites` becomes a human-facing, session-authed router

`routers/invites_admin.py` moves from `dependencies=[Depends(require_admin)]` to
`dependencies=[Depends(require_current_admin)]`, and `POST` additionally takes
`Depends(require_csrf)`, exactly as `routers/users_admin.py` does for its writes. The bearer
path is removed, not kept alongside: it has no caller, and a route that accepts two credentials
is a third auth shape to reason about for nothing. Update the module docstring, and the sentence
in `users_admin.py`'s docstring that calls `/admin/invites` "the `ADMIN_TOKEN` `require_admin`
… next door" (it is now the same gate). The project spec §5 row that names `/admin/invites` as
the write-surface precedent stays true and needs no edit.

Tests in `tests/integration/routers/test_invites_admin.py`: drop `_admin_header`, use the
`admin_authed_client` / `authed_client` / anonymous `client` fixtures from
`tests/fixtures/users.py`, and mirror `test_users_admin.py`'s auth matrix — anonymous 401
(`auth_required`), signed-in non-admin 403 (`admin_required`), list works without the CSRF
header, mint refused without it (403 `csrf_invalid`).

### D-1408.2 — `InviteOut` gains `consumed_by_email`

`consumed_by_user_id` is a UUID the admin cannot do anything with (`/admin/users` searches by
address, not id). `InviteOut` keeps `consumed_by_user_id` and adds `consumed_by_email: str | None`,
resolved at read time by an outer join from `app.invite.consumed_by_user_id` to `app.user.id`
in `invite_repo.list_all` (and populated as `None` on the `POST` response, which is by
construction unconsumed). No migration: nothing is stored. The FK is `ondelete="SET NULL"`, so
an invite spent by a since-deleted account has both fields null and the page renders
"Used <date>" with no "by". One test: a consumed invite lists the consumer's email.

### D-1408.3 — The page is two sections, outstanding first

`pages/AdminInvites.tsx` at route `admin/invites`, under `RequireAdmin` → `AdminLayout` in
`src/routes.ts`, with `{ label: "Invites", href: "/admin/invites" }` appended to
`ADMIN_NAV_ITEMS`. Follows `pages/AdminUsers.tsx` for container, heading, table and empty-state
shape. One `GET` feeds both sections; the split is `consumed_at === null`. The list is unpaged
on the backend and stays so here.

1. **Mint form** at the top: an optional `type="email"` input labelled "Email (optional)"
   (`maxLength={320}`, matching the address cap the backend enforces elsewhere), a short line
   explaining that a hinted code can only be spent by that address, and a "Mint invite" button.
   Success prepends the new row to Outstanding (write the `POST` response into the
   `["admin-invites"]` cache, `useWriteBackAccount`-style, rather than refetching), clears the
   input, and toasts "Invite minted". Failure toasts the error, as `useGrantEntitlement` does.
2. **Outstanding** (`consumed_at === null`, newest first): columns Code (monospace), For
   (`email_hint`, or a muted "Anyone"), Created (`formatEventDate`), and a **Copy link** control
   per row (D-1408.4). Empty state: "No outstanding invites."
3. **Used** (`consumed_at !== null`, newest `consumed_at` first): Code, For, Used
   (`formatEventDate(consumed_at)`), By (`consumed_by_email`, or a muted "—" when null). No
   copy control: a spent code is a dead link. Empty state: "No invites have been used yet."

Heading copy under the `<h1>Invites</h1>`: "Signup is invite-only until subscriptions launch.
Mint a code, copy its link, and send it yourself — nothing is emailed from here. An invite gets
someone an account; access is still granted separately on the Users page." (That last sentence
is the invite ≠ grant boundary from the ticket, said where the admin will look for the missing
step.)

### D-1408.4 — The copied link is the signup page on this site's origin, with the hint prefilled

A pure helper `lib/invite-url.ts` → `inviteSignupUrl(invite: Invite, origin: string): string`
returns `${origin}/signup?invite=<code>` and appends `&email=<email_hint>` when the hint is set,
both values through `URLSearchParams` so a `+` in an address survives. The origin is
`window.location.origin` at the call site (the page is SPA-only, like `lib/ical-url.ts`'s
caller), passed in so the helper is testable without a DOM. `Signup.tsx` already reads both
parameters (its test "pre-fills email from ?email= as well" covers it), so the signup page does
not change for this.

Copying mirrors `Settings.tsx`'s `CalendarSection`: `navigator.clipboard.writeText`, track
*which code* was copied (not a boolean) so only that row reads "Copied." via a `role="status"`
`aria-live="polite"` line, and on a thrown clipboard error show the full URL in a read-only
input beside a `role="alert"` "We could not reach your clipboard. Select the link and copy it
yourself." Nothing is auto-copied on mint: the admin clicks Copy on the new top row.

### D-1408.5 — Signup's invite help text stops claiming anyone can sign up

`Signup.tsx`'s `#invite-code-help` currently reads "Optional — anyone can sign up. A code just
links your account to whoever sent it." The frontend cannot see `SIGNUP_OPEN`, so the sentence
has to be true in both states. Replace with: "Enter the code you were sent, if you have one."
The disclosure button, collapsed default, `?invite=` opening and the 403 handling are unchanged;
existing tests cover them and none asserts on the old help copy.

### D-1408.6 — The flag flips in deploy config and the example env, not in code

`config.py`'s `signup_open` default stays `True`: the comment there frames `false` as the
rollback state, and the code default is what the test suite and a fresh checkout run under.
`backend/.env.example`'s commented line becomes `# SIGNUP_OPEN=false`, with its comment extended
by one sentence saying this is the deployed value until *bl: Subscription & Billing* reopens
signup. Setting `SIGNUP_OPEN=false` in Coolify is an ops step the implementer cannot perform; it
goes on the frontend PR's checklist and is done by hand, **last** (see deploy order).

## Deploy order

1. Backend PR (D-1408.1, D-1408.2, `.env.example`) merges and deploys. Until it does, the
   frontend page would 401 on every request.
2. Frontend PR (page, nav, helper, signup copy) merges and deploys.
3. Only then set `SIGNUP_OPEN=false` in Coolify. Closing signup before the page exists puts curl
   back as the only way in.

## Files

**Backend** (`feat(invites): …` scope)
- `src/upmovies/routers/invites_admin.py` — gate swap, CSRF on POST, docstring.
- `src/upmovies/routers/users_admin.py` — docstring sentence about the neighbour.
- `src/upmovies/app/dto.py` — `InviteOut.consumed_by_email`.
- `src/upmovies/app/repos/invite_repo.py` — `list_all` outer-joins the consumer's email
  (return shape is the repo's choice; the service maps it into `InviteOut`).
- `src/upmovies/app/services/invite_service.py` — `list_invites` passes the email through.
- `tests/integration/routers/test_invites_admin.py` — session-auth matrix, consumed email.
- `.env.example` — `# SIGNUP_OPEN=false` and the comment.

**Frontend** (`feat(admin): …` scope)
- `src/api/types.ts` — `Invite` mirroring `InviteOut` (`code`, `email_hint`, `created_at`,
  `consumed_at`, `consumed_by_user_id`, `consumed_by_email`).
- `src/api/invites.ts` — `fetchInvites`, `createInvite`, `useInvites`
  (`queryKey: ["admin-invites"]`), `useCreateInvite` with cache prepend + toasts;
  `src/api/invites.test.ts` for the fetchers.
- `src/lib/invite-url.ts` + `invite-url.test.ts`.
- `src/pages/AdminInvites.tsx` + `AdminInvites.test.tsx` (pattern: `AdminUsers.test.tsx`; MSW
  helper `src/test/msw/invites.ts` with `makeInvite(overrides)` like `resolution.ts`'s
  `makeDecision`).
- `src/routes.ts`, `src/components/layout/admin-nav-items.ts`.
- `src/pages/Signup.tsx` — help copy only.

## Acceptance criteria

- Anonymous `GET /admin/invites` → 401; signed-in non-admin → 403; session admin → 200 without
  a CSRF header. `POST` as session admin without `X-CSRF-Token` → 403 `csrf_invalid`; with it
  → 201. The bearer-token path no longer authenticates.
- A consumed invite lists `consumed_by_email` of the account that spent it; an outstanding one
  lists `null` for both consumer fields.
- `/admin/invites` renders under the admin tab strip with an "Invites" tab; non-admins are
  redirected as on every other admin route.
- Minting with no email produces a row under Outstanding reading "Anyone"; minting with an
  address shows that address; the input clears and a success toast appears.
- Copy on an outstanding row puts `<origin>/signup?invite=<code>` on the clipboard, plus
  `&email=<hint>` when hinted, and that row alone reads "Copied."; a clipboard failure shows
  the URL in a selectable field with an alert.
- Used rows show the consumed date and email, and carry no Copy control.
- Opening a copied link lands on `/signup` with the code field open and prefilled, and the
  email prefilled when hinted (existing behaviour, asserted once from this page's helper test
  by URL shape).
- The signup invite help text no longer says anyone can sign up.
- `backend/.env.example` shows `# SIGNUP_OPEN=false`; the PR checklist names the Coolify
  variable and the deploy order.
- Backend: full suite green. Frontend: `task test`, `task lint`, `task typecheck` green,
  touched files prettier-formatted.

## Out of scope (own ticket if wanted)

- **Delivery.** Nothing is emailed; the admin pastes the link. Wiring invites through the
  `mail/` gateway is separate work.
- **Invite ≠ grant.** `app.invite` carries no entitlement; an invited user still needs a grant
  at `/admin/users`. Fusing the two is a design decision, not part of this.
- **Revoking or expiring invites.** No delete route exists; a minted code is spendable until
  used. Not added here.
- **Paging the invite list.** `GET /admin/invites` returns everything; fine at this volume.
- **Flipping `config.py`'s default.** Stays `true` (D-1408.6).
- **The public "Sign up" entry point.** NEU-1409 owns it.
