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
  displayName?: string | null;
  email?: string | null;
  className?: string;
}) {
  // An anonymous visitor has no name and no address, so there is nothing to take initials
  // from. A generic figure says "this is the account control" without inventing a person.
  const anonymous = !displayName?.trim() && !email?.trim();

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-full",
        "border border-border bg-muted font-mono text-xs font-medium text-foreground",
        anonymous && "text-muted-foreground",
        className,
      )}
    >
      {anonymous ? <PersonGlyph /> : accountInitials(displayName, email)}
    </span>
  );
}

/** Inline rather than `lucide-react`: the icons already in this app are hand-rolled SVGs
 *  (the hamburger in `MobileMenu`), and one glyph is not worth diverging over. */
function PersonGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="8" r="3.25" />
      <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}
