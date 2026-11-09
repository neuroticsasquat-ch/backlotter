/** The heading over a day's "In the news" or NOT_YET_REPORTED_LABEL section, on the grouped
 *  feed and the film page alike. A filled light bar with dark text, so it reads as the divider
 *  between a day's two halves rather than as one more row of the striped list beneath it.
 *  `qualifier` renders after the label at normal weight — the Not yet reported section's
 *  "(unconfirmed)". The tag differs by page (the feed's day heading is an h2, the film page's an
 *  h3), so the caller names it. */
export function SectionHeading({
  as: Tag,
  label,
  qualifier,
}: {
  as: "h3" | "h4";
  label: string;
  qualifier?: string;
}) {
  return (
    <Tag className="mb-1.5 rounded bg-foreground/90 px-2 py-1 text-sm font-bold tracking-wide text-background">
      {label}
      {/* The space sits outside the span: inside it, the accessible name drops it and a
          screen reader runs the two words together. */}
      {qualifier && (
        <>
          {" "}
          <span className="font-normal">{qualifier}</span>
        </>
      )}
    </Tag>
  );
}
