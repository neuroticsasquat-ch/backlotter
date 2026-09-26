import { Loader2 } from "lucide-react"

import { cn } from "@/lib/cn"

/** A small spinning mark for "a request is in flight". Decorative: the caller's status region
 *  says so to a screen reader, and the caller positions it (NEU-1469). */
function Spinner({ className }: { className?: string }) {
  return (
    <Loader2
      aria-hidden="true"
      data-testid="spinner"
      className={cn("pointer-events-none h-4 w-4 animate-spin text-muted-foreground", className)}
    />
  )
}

export { Spinner }
