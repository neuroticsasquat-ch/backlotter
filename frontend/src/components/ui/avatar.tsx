import { cn } from "@/lib/cn";
import { accountInitials } from "@/lib/initials";

/**
 * The account avatar: initials in a circle.
 *
 * Initials rather than a picture because there is no picture to show — the account model
 * carries a display name and an email and nothing else. Circular rather than the rounded
 * squares used elsewhere in the app, deliberately: the shape is the signal that this control
 * is *you* rather than another destination, which is the whole point of replacing a row of
 * identical text links with it.
 *
 * The initials are `aria-hidden` — they are a visual shorthand, and the control that wraps
 * this carries the real accessible name.
 */
export function Avatar({
  displayName,
  email,
  className,
}: {
  displayName: string | null | undefined;
  email?: string | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-full",
        "border border-border bg-muted font-mono text-xs font-medium text-foreground",
        className,
      )}
    >
      {accountInitials(displayName, email)}
    </span>
  );
}
