import type { ArcStage } from "@/api/types";
import { cn } from "@/lib/cn";
import { ARC_STAGES, ARC_STAGE_LABELS } from "./labels";

/** The 7-stage status arc as a vertical timeline: dots connected by a rail, with the
 *  completed portion filled (brand blue) and the rest hollow/muted. Dots sit on the
 *  left edge nearest the poster; the current stage is emphasised. */
export function ArcStepper({ current }: { current: ArcStage }) {
  const currentIndex = ARC_STAGES.indexOf(current);
  return (
    <ol role="list" className="flex flex-col" aria-label="Production status">
      {ARC_STAGES.map((stage, i) => {
        const state = i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming";
        const isLast = i === ARC_STAGES.length - 1;
        // The rail segment below dot i is "travelled" only once that stage is behind us.
        const railTravelled = i < currentIndex;
        return (
          <li
            key={stage}
            aria-current={state === "current" ? "step" : undefined}
            className="flex gap-3"
          >
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "mt-0.5 h-3 w-3 shrink-0 rounded-full",
                  // Completed stages are a calm, muted blue; the current stage is a
                  // brighter blue with a halo so it clearly reads as "you are here".
                  state === "done" && "bg-blue-700",
                  state === "current" && "bg-blue-400 ring-4 ring-blue-400/50",
                  state === "upcoming" && "border-2 border-gray-600 bg-background",
                )}
              />
              {!isLast && (
                <span
                  aria-hidden="true"
                  className={cn("w-0.5 flex-1", railTravelled ? "bg-blue-700" : "bg-gray-600")}
                />
              )}
            </div>
            <span
              className={cn(
                "pb-3.5 text-sm leading-none",
                state === "current" ? "font-semibold text-blue-400" : "text-muted-foreground",
              )}
            >
              {ARC_STAGE_LABELS[stage]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
