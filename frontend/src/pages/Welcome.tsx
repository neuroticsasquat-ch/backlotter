import { useState } from "react";
import { Link } from "react-router";
import { useImportJob } from "@/api/imports";
import { useFollows } from "@/api/me";
import { LockedPanel, useFollowAccess } from "@/components/follow/access";
import { ImportProgress } from "@/components/onboarding/ImportProgress";
import { ImportStep } from "@/components/onboarding/ImportStep";
import { PeopleStep } from "@/components/onboarding/PeopleStep";
import { Button } from "@/components/ui/button";

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

  if (access === "locked") return <LockedWelcome />;

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
function LockedWelcome() {
  return (
    <LockedPanel heading="We are not open to everyone yet">
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
