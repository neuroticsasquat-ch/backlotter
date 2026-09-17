import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ApiError } from "@/api/client";
import { useImportJob, useSubmitTmdbApproval } from "@/api/imports";
import { useFollows } from "@/api/me";
import { LockedPanel, useFollowAccess } from "@/components/follow/access";
import { ImportProgress } from "@/components/onboarding/ImportProgress";
import { ImportStep } from "@/components/onboarding/ImportStep";
import { PeopleStep } from "@/components/onboarding/PeopleStep";
import { Button } from "@/components/ui/button";
import { rememberTmdbImport } from "@/lib/tmdb-import";

/** The query TMDB sends the user back with. `tmdb=callback` is ours — it is baked into the
 *  `TMDB_REDIRECT_URL` the start route hands TMDB (NEU-1357 §2) — and `request_token` /
 *  `approved` are TMDB's own, appended to it. */
const CALLBACK_MARKER = "callback";

/** The callback's refusals, in the user's terms. The backend's `detail` strings are stable
 *  identifiers for a caller, not sentences for a reader. */
function approvalMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400 && error.message === "tmdb_token_expired")
      return "That approval sat for too long and expired. Connect TMDB again and we will start over.";
    if (error.status === 400)
      return "You did not approve the connection at TMDB, so nothing was imported.";
    if (error.status === 403 && error.message === "entitlement_required")
      return "Importing is part of the subscription, and your access has not been granted yet.";
    if (error.status === 403)
      return "That approval was not for this account. Connect TMDB again while signed in here.";
    if (error.status === 409)
      return "One of your imports is still running. Wait for it to finish before starting another.";
  }
  return "We could not finish connecting your TMDB account. Please try again.";
}

/**
 * Finish the TMDB approve flow when the user lands back here from themoviedb.org (NEU-1359).
 *
 * `/welcome` is where every approval returns, whichever page sent the user out:
 * `TMDB_REDIRECT_URL` is one backend setting, not a per-request parameter. From the 202 on, a
 * TMDB import is just an import job, so the id goes into the same slot the upload fills and
 * the same progress panel reports it.
 *
 * The params are cleared **before** the request goes out, and a ref makes the whole thing
 * fire once. Both matter for the same reason: a request token is spent on first use and
 * deleted server-side, so a re-run — StrictMode's second effect pass, or a refresh of a URL
 * that still carried the token — posts a token that is already gone and turns a successful
 * import into a 403 on the screen.
 */
function useTmdbReturn(onStarted: (jobId: string) => void) {
  const [params, setParams] = useSearchParams();
  const submit = useSubmitTmdbApproval();
  const handled = useRef(false);

  // Latched at mount rather than read on every render, because the effect below immediately
  // clears the query it comes from: a derived-each-render version would evaluate to "no
  // approval here" the moment the URL is tidied, taking the message about a malformed return
  // with it. An arrival happens once, so it is read once.
  const [arrival] = useState(() => ({
    isReturn: params.get("tmdb") === CALLBACK_MARKER,
    requestToken: params.get("request_token"),
    approved: params.get("approved") === "true",
  }));

  useEffect(() => {
    if (!arrival.isReturn || handled.current) return;
    handled.current = true;
    setParams(new URLSearchParams(), { replace: true });
    // TMDB sends the token on every return, approval or refusal alike, so its absence is not a
    // user saying no — it is a URL that did not come from TMDB, and there is nothing to post.
    if (arrival.requestToken === null) return;

    submit.mutate(
      { requestToken: arrival.requestToken, approved: arrival.approved },
      {
        onSuccess: (started) => {
          rememberTmdbImport(started.job_id);
          onStarted(started.job_id);
        },
      },
    );
  }, [arrival, setParams, submit, onStarted]);

  // Both failures are read where they live rather than copied into state: the mutation already
  // holds its own error, and the malformed case is a property of the URL we arrived on.
  const error = submit.error
    ? approvalMessage(submit.error)
    : arrival.isReturn && arrival.requestToken === null
      ? "That link did not carry an approval from TMDB. Connect TMDB again to retry."
      : null;

  return { error, pending: submit.isPending };
}

const STEPS = ["Import", "People", "Done"] as const;

type Step = 0 | 1 | 2;

/**
 * `/welcome` — the three steps between a new account and a timeline worth reading (D-17).
 *
 * Progress is component state and nothing else: there is no server-side notion of "onboarded",
 * so the route is re-enterable from the header at any time and re-entering it starts at step 1
 * again. That is the intended behaviour, not a gap — the two steps are an import and a set of
 * follows, both of which are idempotent and both of which a returning user may legitimately
 * want to do a second time.
 *
 * Every step is skippable on its own, so the flow never holds an account hostage to a file it
 * does not have (D-17). Skipping and continuing differ only in the copy on the control; both
 * go to the next step, because a user who has followed six people and one who has followed
 * none are in the same place afterwards.
 */
export function Welcome() {
  const access = useFollowAccess();
  const [step, setStep] = useState<Step>(0);
  // Held here rather than inside step 1 so the poll outlives that step's unmount: a large
  // library is minutes of TMDB lookups (D-15) and the user is explicitly invited to carry on
  // to step 2 while it runs. The job's progress follows them there.
  const [jobId, setJobId] = useState<string | null>(null);
  const { data: job, error: jobError } = useImportJob(jobId);
  // Deliberately run even for a locked account. A user whose grant lapsed between approving at
  // TMDB and landing back here is holding a live TMDB session, and posting the callback is what
  // makes the backend delete it — refusing to call it from a locked screen would leave the one
  // credential the one-shot design has no other way to clean up (NEU-1357, D-39).
  const tmdb = useTmdbReturn(setJobId);

  if (access === "locked") return <LockedWelcome tmdbError={tmdb.error} />;

  const next = () => setStep((current) => (current === 2 ? current : ((current + 1) as Step)));

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Welcome to backlotter</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Two quick steps and your timeline will have something on it.
      </p>

      <StepIndicator current={step} />

      <div className="mt-6">
        {step === 0 && (
          <ImportStep job={job ?? null} onStarted={setJobId} onContinue={next} onSkip={next} />
        )}
        {step === 1 && <PeopleStep onContinue={next} onSkip={next} />}
        {step === 2 && <DoneStep />}
      </div>

      {/* The import's progress rides along on the later steps, where step 1 is no longer
          rendering it. Without this the bar the user was watching disappears when they
          continue, which reads as the import having been cancelled by moving on. */}
      {step !== 0 && job && <ImportProgress job={job} />}

      {/* The poll does not retry, because both failures it can see are permanent (`api/imports`).
          Saying so matters more than it looks: the user has just handed over a file, and a
          progress panel that never appears is indistinguishable from an import that was never
          started. */}
      {jobError && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          We lost track of that import. It may still be running — check your follows in a few
          minutes.
        </p>
      )}

      {/* Rendered at the flow level rather than inside step 1, so a refusal survives the user
          carrying on to step 2 — the approval is gone either way and the message is the only
          record they get of why nothing is importing. */}
      {tmdb.pending && (
        <p className="mt-4 text-sm text-muted-foreground" aria-live="polite">
          Finishing the connection to TMDB…
        </p>
      )}
      {tmdb.error && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {tmdb.error}
        </p>
      )}
    </div>
  );
}

function StepIndicator({ current }: { current: Step }) {
  return (
    <ol className="mt-6 flex gap-2" aria-label="Onboarding progress">
      {STEPS.map((label, index) => (
        <li
          key={label}
          aria-current={index === current ? "step" : undefined}
          className={`flex-1 rounded-full px-3 py-1 text-center text-xs font-medium ${
            index === current
              ? "bg-primary text-primary-foreground"
              : index < current
                ? "bg-muted text-foreground"
                : "bg-muted/50 text-muted-foreground"
          }`}
        >
          {index + 1}. {label}
        </li>
      ))}
    </ol>
  );
}

/** Step 3: what the account now has, and the way out of the flow. Not an automatic redirect —
 *  landing on the timeline without being told an import is still filling it in would read as
 *  the import having done nothing. */
function DoneStep() {
  const { data } = useFollows();
  const count = data?.items.length ?? 0;

  return (
    <section aria-labelledby="done-step-heading">
      <h2 id="done-step-heading" className="text-xl font-semibold text-foreground">
        That is everything
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {count > 0
          ? `You follow ${count} ${count === 1 ? "thing" : "things"}. Your timeline covers every film they touch, from the first announcement to the day you can watch it at home.`
          : "You have not followed anything yet, so your timeline is empty for now. Follow buttons live on every film page, and you can come back here whenever you like."}
      </p>
      <Button asChild className="mt-6">
        <Link to="/">Go to my timeline</Link>
      </Button>
    </section>
  );
}

/** D-41: a signed-in account without a grant is told what it is missing rather than walked
 *  into three steps whose first request would 403. The copy is the onboarding route's own —
 *  this user came here to set something up, so "come back and we will" is the honest answer,
 *  not the follows page's "your follows are not open yet". */
function LockedWelcome({ tmdbError }: { tmdbError: string | null }) {
  return (
    <LockedPanel heading="We are not open to everyone yet">
      {/* An account whose grant lapsed between approving at TMDB and landing back here has just
          had an approval refused, and the panel's own copy does not account for it. Saying so is
          what keeps the locked state honest (D-41): the user did something, and it did not
          work. */}
      {tmdbError && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {tmdbError}
        </p>
      )}
      <p className="mt-2 text-sm text-muted-foreground">
        Following people and importing your library are part of the subscription, and access is
        limited while we build that tier. There is nothing to buy yet — your account is ready and
        waiting for a grant.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        When your access arrives, come back here and we will set your timeline up in two steps.
        Everything you have followed before is kept in the meantime.
      </p>
    </LockedPanel>
  );
}

export default Welcome;
