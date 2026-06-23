import type { ArcStage } from "@/api/types";
import { cn } from "@/lib/cn";
import { ARC_STAGES, ARC_STAGE_LABELS } from "./labels";

/** The 7-stage status arc as a dotted stepper, with the current stage highlighted. */
export function ArcStepper({ current }: { current: ArcStage }) {
  const currentIndex = ARC_STAGES.indexOf(current);
  return (
    <ol
      role="list"
      className="flex items-start gap-1 overflow-x-auto py-2"
      aria-label="Production status"
    >
      {ARC_STAGES.map((stage, i) => {
        const state = i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming";
        return (
          <li
            key={stage}
            aria-current={state === "current" ? "step" : undefined}
            className="flex min-w-14 flex-1 flex-col items-center gap-1"
          >
            <span
              className={cn(
                "h-3 w-3 rounded-full",
                state === "done" && "bg-gray-500",
                state === "current" && "bg-blue-600 ring-4 ring-blue-600/25",
                state === "upcoming" && "bg-gray-300",
              )}
            />
            <span
              className={cn(
                "text-[10px]",
                state === "current" ? "font-semibold text-blue-600" : "text-gray-500",
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
