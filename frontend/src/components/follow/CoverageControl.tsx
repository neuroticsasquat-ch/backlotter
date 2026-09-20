import { useId } from "react";
import type { FollowCoverage } from "@/api/types";
import { Label } from "@/components/ui/label";

/** The three tiers a person follow can be set to (D-48), in the order they widen. Companies,
 *  franchises and titles name one thing each and have nothing to narrow, so they draw no
 *  control — and the backend refuses a `coverage` on them outright. */
const COVERAGE_OPTIONS: { value: FollowCoverage; label: string }[] = [
  { value: "lead", label: "Lead roles" },
  { value: "major", label: "Major credits" },
  { value: "any", label: "Every credit" },
];

/**
 * How deep into a followed person's credits to go.
 *
 * Radios rather than a switch, because none of the three is the absence of the others: `lead`
 * is a real editorial cut (director or top-3 billing), `major` the seed grade, and `any` every
 * credit at any billing — a reader picking the first is asking for fewer alerts, not for the
 * control to be off.
 *
 * Controlled, because its two callers disagree about what a change *means*: on `/me/follows`
 * every row is a follow that exists and a change is a PATCH, while on a person page the
 * control is visible before there is a follow at all and the value is local state the follow
 * will be created with (D-1416.8). Owning the mutation here would force the second case to
 * fake a follow row to render.
 */
export function CoverageControl({
  value,
  onChange,
  label,
  disabled = false,
  className,
}: {
  value: FollowCoverage;
  onChange: (coverage: FollowCoverage) => void;
  /** The person's own name — used to say which follow the radio group belongs to, on a page
   *  that may carry several. */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const groupId = useId();

  return (
    <fieldset className={className} disabled={disabled}>
      <legend className="sr-only">{`Which of ${label}'s credits to alert me about`}</legend>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {COVERAGE_OPTIONS.map((option) => {
          const id = `${groupId}-${option.value}`;
          return (
            <div key={option.value} className="flex items-center gap-1.5">
              <input
                id={id}
                type="radio"
                name={groupId}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
                className="h-3.5 w-3.5"
              />
              <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
                {option.label}
              </Label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
