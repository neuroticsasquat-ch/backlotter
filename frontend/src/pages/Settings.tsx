import { useEffect, useId, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";

import * as authApi from "@/api/auth";
import { ApiError, setCsrfToken } from "@/api/client";
import { useRotateIcalToken, useSettings, useUpdateDigestCadence } from "@/api/me";
import type { AuthedUser, DigestCadence } from "@/api/types";
import { useAuth } from "@/components/AuthContext";
import { TmdbConnect } from "@/components/onboarding/TmdbConnect";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { calendarFeedUrls } from "@/lib/ical-url";

/** Mirror `PasswordChangeRequest.new_password` on the backend, as `/reset` mirrors its own
 *  request model: the three ways a password gets set share one policy. */
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

/** The day both cadences carry the slate (DC-2). Mirrors the backend `SLATE_WEEKDAY` default,
 *  by hand: the setting is product-wide rather than per-user and no route exposes it, so an
 *  override in Coolify leaves this copy naming the wrong day until it is changed here too. */
const SLATE_WEEKDAY = "Thursday";

const CADENCES: { value: DigestCadence; label: string; help: string }[] = [
  {
    value: "daily",
    label: "Daily",
    help: `Every morning there is news on your follows, plus your slate on ${SLATE_WEEKDAY}s.`,
  },
  {
    value: "weekly",
    label: "Weekly",
    help: `Your slate and the week's news, in one mail every ${SLATE_WEEKDAY}. The default.`,
  },
  { value: "off", label: "Off", help: "No mail. Everything is still on your timeline." },
];

/** The refusals the password-checked account routes give, in the user's terms. Both routes
 *  answer 401 `invalid_credentials` for the wrong password; only the email change can 409. */
function accountChangeMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "That is not your current password.";
    if (error.status === 409) return "That address already belongs to another account.";
  }
  return "Something went wrong. Please try again.";
}

const sectionClass = "mt-8 rounded-lg border border-border p-6";
const linkClass = "underline underline-offset-4 hover:text-foreground";

/**
 * `/me/settings` — the account and how it hears from us (NEU-1382).
 *
 * Under `RequireAuth` but deliberately not under `RequireEntitled`: the account basics —
 * address, verification, password — belong to every signed-in account, and an account without
 * a grant needs somewhere to change its password. Only the delivery block is subscriber
 * functionality, so only that block is replaced by the locked panel (D-41).
 */
export function Settings() {
  const { user } = useAuth();
  const unsubscribed = useUnsubscribeLanding();
  // `RequireAuth` has already sent an anonymous visitor away; this is the render before `/me`
  // resolves, and there is nothing to show about an account that has not arrived yet.
  if (!user) return null;

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Your account, and how we get in touch about the films you follow.
      </p>

      <AccountSection user={user} />
      <ChangeEmailForm currentEmail={user.email} />
      <ChangePasswordForm />

      {user.entitled ? (
        <>
          <DigestSection unsubscribed={unsubscribed} />
          <CalendarSection />
          <LibrarySection />
        </>
      ) : (
        <LockedDeliverySection />
      )}
    </div>
  );
}

/**
 * Whether this visit is the landing from the digest's unsubscribe link, which the backend
 * answers with a redirect to `/me/settings?digest=off` (DC-10).
 *
 * Read once, then the parameter is dropped from the URL by `replace` — so a reload has nothing
 * left to read and Back does not return to it, which is what makes the notice show once. It is
 * dropped for every account, not only the ones that render the digest section: a lapsed grant
 * can still click the link in an old mail.
 */
function useUnsubscribeLanding(): boolean {
  const [params, setParams] = useSearchParams();
  const [landed] = useState(() => params.get("digest") === "off");

  useEffect(() => {
    if (!params.has("digest")) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("digest");
        return next;
      },
      { replace: true },
    );
  }, [params, setParams]);

  return landed;
}

function AccountSection({ user }: { user: AuthedUser }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={sectionClass}>
      <h2 id={headingId} className="text-lg font-semibold text-foreground">
        Account
      </h2>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Email</dt>
        <dd className="text-foreground">{user.email}</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd className="text-foreground">
          {user.email_verified ? (
            "Verified"
          ) : (
            <>
              Not verified —{" "}
              <Link to="/verify" className={linkClass}>
                confirm it
              </Link>{" "}
              so we can send you mail.
            </>
          )}
        </dd>
      </dl>
    </section>
  );
}

/**
 * Start moving the account to a new address (NEU-1341). Nothing changes here: the new address
 * gets a link, and the account moves when it is opened at `/email-change`. The password is
 * asked for even on an authed page because an address change is the one edit that takes the
 * account with it.
 */
function ChangeEmailForm({ currentEmail }: { currentEmail: string }) {
  const headingId = useId();
  const emailId = useId();
  const passwordId = useId();
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await authApi.requestEmailChange({ new_email: newEmail, current_password: password });
      setSentTo(newEmail);
      setNewEmail("");
      setPassword("");
    } catch (err) {
      setError(accountChangeMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} aria-labelledby={headingId} className={sectionClass}>
      <h2 id={headingId} className="text-lg font-semibold text-foreground">
        Change your email
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        We send a confirmation link to the new address. Nothing changes until you open it.
      </p>

      {sentTo && (
        <p role="status" className="mt-3 text-sm text-foreground">
          Check <strong>{sentTo}</strong> for a confirmation link. Until you open it, mail keeps
          going to {currentEmail}.
        </p>
      )}

      <div className="mt-4 space-y-4">
        <div>
          <Label htmlFor={emailId}>New email</Label>
          <Input
            id={emailId}
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            required
            autoComplete="email"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor={passwordId}>Current password</Label>
          <Input
            id={passwordId}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="mt-1"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <Button type="submit" variant="outline" disabled={submitting}>
          {submitting ? "Sending…" : "Send confirmation link"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Set a new password against the current one. The backend rotates the session as it does so
 * and answers with a fresh CSRF token, which has to be installed here — otherwise the next
 * mutation from this tab fails its CSRF check with a password that just changed successfully.
 */
function ChangePasswordForm() {
  const qc = useQueryClient();
  const headingId = useId();
  const currentId = useId();
  const newId = useId();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setChanged(false);
    setSubmitting(true);
    try {
      const user = await authApi.changePassword({ current_password: current, new_password: next });
      setCsrfToken(user.csrf_token);
      qc.setQueryData(["me"], user);
      setChanged(true);
      setCurrent("");
      setNext("");
    } catch (err) {
      setError(accountChangeMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} aria-labelledby={headingId} className={sectionClass}>
      <h2 id={headingId} className="text-lg font-semibold text-foreground">
        Change your password
      </h2>

      {changed && (
        <p role="status" className="mt-3 text-sm text-foreground">
          Password changed.
        </p>
      )}

      <div className="mt-4 space-y-4">
        <div>
          <Label htmlFor={currentId}>Current password</Label>
          <Input
            id={currentId}
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
            autoComplete="current-password"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor={newId}>New password</Label>
          <Input
            id={newId}
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={MAX_PASSWORD_LENGTH}
            autoComplete="new-password"
            className="mt-1"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <Button type="submit" variant="outline" disabled={submitting}>
          {submitting ? "Changing…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}

/**
 * The digest cadence (D-33), saved on change rather than behind a button: three radios and one
 * field is not a form worth submitting.
 *
 * `unsubscribed` is the landing from the mail's unsubscribe link. Its notice is shown only while
 * the saved cadence agrees with it, so it never claims an unsubscribe the server did not take,
 * and it goes for good at the first cadence the user picks — once, not again on a return to Off.
 */
function DigestSection({ unsubscribed }: { unsubscribed: boolean }) {
  const headingId = useId();
  const { data, isLoading, isError } = useSettings();
  const update = useUpdateDigestCadence();
  const [notice, setNotice] = useState(unsubscribed);

  return (
    <section aria-labelledby={headingId} className={sectionClass}>
      <h2 id={headingId} className="text-lg font-semibold text-foreground">
        Digest email
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        What happened to the films, people, studios and franchises you follow, one entry per film —
        and on {SLATE_WEEKDAY}s, the dates coming up for the films among them.
      </p>

      {isLoading && <p className="mt-3 text-sm text-muted-foreground">Loading…</p>}
      {isError && <p className="mt-3 text-sm text-red-600">We could not load your settings.</p>}

      {data && notice && data.digest_cadence === "off" && (
        <p role="status" className="mt-3 text-sm text-foreground">
          Your digest is off.
        </p>
      )}

      {data && (
        <fieldset className="mt-4" disabled={update.isPending}>
          <legend className="sr-only">How often to send the digest</legend>
          <div className="space-y-3">
            {CADENCES.map((option) => (
              <CadenceOption
                key={option.value}
                option={option}
                checked={data.digest_cadence === option.value}
                onSelect={() => {
                  setNotice(false);
                  update.mutate(option.value);
                }}
              />
            ))}
          </div>
          <p role="status" aria-live="polite" className="mt-3 text-xs text-muted-foreground">
            {update.isSuccess ? "Saved." : ""}
          </p>
        </fieldset>
      )}
    </section>
  );
}

function CadenceOption({
  option,
  checked,
  onSelect,
}: {
  option: (typeof CADENCES)[number];
  checked: boolean;
  onSelect: () => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="radio"
        name="digest_cadence"
        value={option.value}
        checked={checked}
        onChange={onSelect}
        className="mt-1"
      />
      <div>
        <Label htmlFor={id}>{option.label}</Label>
        <p className="mt-0.5 text-xs text-muted-foreground">{option.help}</p>
      </div>
    </div>
  );
}

/**
 * The calendar subscription (D-34, NEU-1384): the user's tokenised feed URL, a way to copy it,
 * a `webcal:` link that hands it to the calendar app, and the rotate that breaks every
 * subscription made from the old one.
 *
 * The token is the whole credential — `/calendar/{token}.ics` takes no cookie — so the URL is
 * treated as a secret in the copy that surrounds it, and rotation is behind a confirm.
 */
function CalendarSection() {
  const headingId = useId();
  const urlId = useId();
  const { data, isLoading, isError } = useSettings();
  const rotate = useRotateIcalToken();
  // The URL that was copied, not a boolean: a rotate makes the clipboard's contents dead, and
  // comparing against the current token is what takes "Copied." back down when that happens.
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);

  const urls = data ? calendarFeedUrls(data.ical_token) : null;

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setCopyFailed(false);
    } catch {
      // No clipboard access (an insecure origin, or a browser that asks and was refused). The
      // URL is on screen in a field the user can select, so say that rather than fail silently.
      setCopiedUrl(null);
      setCopyFailed(true);
    }
  }

  return (
    <section aria-labelledby={headingId} className={sectionClass}>
      <h2 id={headingId} className="text-lg font-semibold text-foreground">
        Calendar
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Subscribe your calendar to the release dates of the films you follow — in theaters, digital
        and disc, each as an all-day event that moves when the date does.
      </p>

      {isLoading && <p className="mt-3 text-sm text-muted-foreground">Loading…</p>}
      {isError && <p className="mt-3 text-sm text-red-600">We could not load your settings.</p>}

      {urls && (
        <>
          <div className="mt-4">
            <Label htmlFor={urlId}>Your calendar link</Label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Input id={urlId} readOnly value={urls.webcal} className="min-w-0 flex-1 font-mono" />
              <Button type="button" variant="outline" onClick={() => copy(urls.webcal)}>
                Copy
              </Button>
              <Button asChild>
                <a href={urls.webcal}>Subscribe</a>
              </Button>
            </div>
            <p role="status" aria-live="polite" className="mt-2 text-xs text-muted-foreground">
              {copiedUrl === urls.webcal ? "Copied." : ""}
            </p>
            {copyFailed && (
              <p role="alert" className="mt-1 text-xs text-red-600">
                We could not reach your clipboard. Select the link above and copy it yourself.
              </p>
            )}
          </div>

          <div className="mt-4 text-xs text-muted-foreground">
            <p>
              <strong className="font-medium text-foreground">Apple Calendar</strong> — Subscribe
              opens it directly. Or File → New Calendar Subscription, and paste the link.
            </p>
            <p className="mt-1">
              <strong className="font-medium text-foreground">Google Calendar</strong> — Other
              calendars → From URL, and paste{" "}
              <a href={urls.https} className={linkClass}>
                the https version
              </a>{" "}
              of the same link.
            </p>
            <p className="mt-2">
              Anyone with this link can read the dates of the films you follow, so keep it to
              yourself.
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ConfirmDialog
              trigger={
                <Button type="button" variant="destructive" size="sm" disabled={rotate.isPending}>
                  Rotate link
                </Button>
              }
              title="Rotate your calendar link?"
              description="Every calendar already subscribed to the old link stops updating, and you will need to subscribe again with the new one. There is no way back to the old link."
              confirmLabel="Rotate"
              onConfirm={() => rotate.mutate()}
            />
            {rotate.isPending && <span className="text-xs text-muted-foreground">Rotating…</span>}
            {rotate.isSuccess && !rotate.isPending && (
              <span role="status" className="text-xs text-muted-foreground">
                New link ready. Subscribe again to keep getting dates.
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** The subscriber surfaces this page is the way back to, plus the TMDB connect control
 *  NEU-1359 asked to be mounted here as well as in onboarding. The approval still returns to
 *  `/welcome` whichever page started it — `TMDB_REDIRECT_URL` is one backend setting — so the
 *  import's progress is reported there, not here. */
function LibrarySection() {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={sectionClass}>
      <h2 id={headingId} className="text-lg font-semibold text-foreground">
        Your library
      </h2>
      <ul className="mt-3 space-y-2 text-sm">
        <li>
          <Link to="/me/follows" className={linkClass}>
            Follows
          </Link>
          <span className="text-muted-foreground">
            {" "}
            — the films, people, studios and franchises you track.
          </span>
        </li>
        <li>
          <Link to="/welcome" className={linkClass}>
            Redo onboarding
          </Link>
          <span className="text-muted-foreground">
            {" "}
            — import a library and pick people to follow again.
          </span>
        </li>
      </ul>
      <TmdbConnect job={null} />
    </section>
  );
}

/**
 * What an account without a grant sees in place of the delivery block (D-41): the honest
 * state, not an empty one. The subscriber links go with it — for this account they would
 * only ever reach another locked panel.
 *
 * The grant's expiry is deliberately absent even though the ticket asks for it: `GET /me`
 * exposes `entitled` and not `entitled_until` (the backend argues the date is the admin
 * surface's business), so there is nothing to render until that contract changes. This block
 * is also where a "manage subscription" link goes once *bl: Subscription & Billing* ships.
 */
function LockedDeliverySection() {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={`${sectionClass} bg-muted/40`}>
      <h2 id={headingId} className="text-lg font-semibold text-foreground">
        Delivery is not open yet
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Digest emails and calendar subscriptions are part of the subscription, along with following
        films and people. Access is limited while we build that tier, so there is nothing to buy
        yet.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Anything you set up before is kept. If your access is restored, it all comes back exactly as
        you left it.
      </p>
      <p className="mt-4 text-sm">
        <Link to="/feed" className={linkClass}>
          Browse everything we track
        </Link>
      </p>
    </section>
  );
}

export default Settings;
