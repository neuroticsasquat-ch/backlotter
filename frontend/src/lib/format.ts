const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function formatEventDate(iso: string): string {
  return DATE_FMT.format(new Date(iso));
}

const DAY_HEADING_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

/** The UTC calendar date of an ISO instant, as "YYYY-MM-DD". Used for day bucketing + keys. */
export function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** A human day heading in UTC, e.g. "Monday, June 23, 2026". */
export function formatDayHeading(iso: string): string {
  return DAY_HEADING_FMT.format(new Date(iso));
}

export function truncate(text: string, max = 155): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}
