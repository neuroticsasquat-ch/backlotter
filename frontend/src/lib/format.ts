import type { ArcStage, HeadlineRelease, ReleaseDate } from "@/api/types";
import { releaseBucketLabel } from "@/components/calendar/release-labels";
import { arcStageLabel } from "@/components/film/labels";

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function formatEventDate(iso: string): string {
  return DATE_FMT.format(new Date(iso));
}

const RELATIVE_FMT = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long ago an instant was, in the coarsest unit that still says something — "3 days ago",
 *  "last month", "2 years ago".
 *
 *  `numeric: "auto"` so the near cases read as words ("yesterday", "last week") rather than as
 *  "1 day ago", which is how a person says it. Months and years are the usual approximations
 *  (30 and 365 days): this is a "when did something last happen here" line on a follows row,
 *  not a date, and a row whose exact anniversary matters would show the date instead.
 *
 *  `now` is injectable so a test can assert on a fixed distance without freezing the clock.
 *  Future instants are not special-cased — `Intl` renders them forwards ("in 2 days") — but
 *  nothing calls this with one: every caller passes a `created_at` the server has already
 *  published. */
export function formatRelativeDate(iso: string, now: Date = new Date()): string {
  const elapsed = now.getTime() - new Date(iso).getTime();
  const past = Math.abs(elapsed);
  const sign = elapsed >= 0 ? -1 : 1;

  if (past < HOUR) return RELATIVE_FMT.format(sign * Math.round(past / MINUTE), "minute");
  if (past < DAY) return RELATIVE_FMT.format(sign * Math.round(past / HOUR), "hour");
  if (past < 30 * DAY) return RELATIVE_FMT.format(sign * Math.round(past / DAY), "day");
  if (past < 365 * DAY) return RELATIVE_FMT.format(sign * Math.round(past / (30 * DAY)), "month");
  return RELATIVE_FMT.format(sign * Math.round(past / (365 * DAY)), "year");
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

const USD_FMT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/** Format a dollar amount as USD with 2–4 fractional digits (LLM costs are sub-cent). */
export function formatUsd(amount: number): string {
  return USD_FMT.format(amount);
}

/**
 * Format a runtime in minutes as a human-readable string.
 * Pure — no Intl, no timezone dependency.
 * Examples: 135 → "2h 15m", 60 → "1h", 45 → "45m", 0/negative → ""
 */
export function formatRuntime(minutes: number): string {
  if (minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

const LANGUAGE_DISPLAY = new Intl.DisplayNames(["en"], { type: "language" });

/**
 * Resolve an ISO 639-1 language code to its English display name.
 * Falls back to the uppercased code if Intl cannot resolve it (returns the
 * code unchanged) or returns undefined.
 * Pins locale to ["en"] for SSR/client determinism.
 */
export function formatLanguage(code: string): string {
  try {
    const name = LANGUAGE_DISPLAY.of(code);
    // Intl.DisplayNames may return the code unchanged when it cannot resolve it
    if (!name || name === code) return code.toUpperCase();
    return name;
  } catch {
    return code.toUpperCase();
  }
}

export interface Rating {
  certification: string; // e.g. "PG-13"
  country: string; // ISO 3166-1 of the rating body, e.g. "US" (MPAA)
}

/**
 * Pick a single content rating (certification + its country) from a film's release
 * dates. Prefers the US/MPAA rating; otherwise the first entry carrying a non-empty
 * certification. Empty-string certifications are treated as absent. Returns null when none.
 */
export function pickRating(dates: ReleaseDate[]): Rating | null {
  const withCert = dates.flatMap((d) =>
    d.certification && d.certification.trim() !== ""
      ? [{ certification: d.certification, country: d.country }]
      : [],
  );
  if (withCert.length === 0) return null;
  return withCert.find((r) => r.country === "US") ?? withCert[0];
}

/** Join with "/", showing at most `cap` values and " +N" for the rest. Null for an empty list. */
function joinCapped(values: string[], cap?: number): string | null {
  if (values.length === 0) return null;
  if (cap == null || values.length <= cap) return values.join("/");
  return `${values.slice(0, cap).join("/")} +${values.length - cap}`;
}

/**
 * Join country display names with "/", capped at `cap` values followed by " +N" for the
 * remainder. Returns null for an empty list so a caller can drop the element entirely.
 * Uncapped by default — the film page's spec sheet has the width; the feed row does not.
 */
export function formatCountryList(countries: string[], opts?: { cap?: number }): string | null {
  return joinCapped(countries, opts?.cap);
}

export interface FilmParentheticalInput {
  production_countries: string[];
  directors: string[];
  release_year: number | null;
  arc_stage: ArcStage;
}

const COUNTRY_CAP = 3;
const DIRECTOR_CAP = 2;

/**
 * The feed row's title parenthetical, without its surrounding parens — countries, director,
 * and year in that order, joined with ", " (NEU-1215).
 *
 * Multi-value elements join with "/" rather than a comma, so the comma always means "next
 * element": "(USA, Dir: Joel Coen, Ethan Coen, 2010)" is unparseable. Absent elements
 * contribute nothing at all — no empty slot, no placeholder separator. The arc-stage label is
 * the last resort for the 2% of films carrying none of the three, where a bare title with no
 * parenthetical would read as a rendering bug.
 */
export function filmParenthetical(input: FilmParentheticalInput): string {
  const parts: string[] = [];

  const countries = formatCountryList(input.production_countries, { cap: COUNTRY_CAP });
  if (countries) parts.push(countries);

  const directors = joinCapped(input.directors, DIRECTOR_CAP);
  if (directors) parts.push(`Dir: ${directors}`);

  if (input.release_year != null) parts.push(String(input.release_year));

  if (parts.length === 0) return arcStageLabel(input.arc_stage);
  return parts.join(", ");
}

/**
 * The watchlist row's date line (NEU-1398) — one string per {@link HeadlineRelease} kind.
 *
 * The three kinds are not interchangeable and must not render alike. `upcoming` and `released`
 * are theatrical dates the film page lists too, so they carry their bucket and country and can
 * be stated plainly; only the tense separates them. `primary` is TMDB's earliest-anywhere date,
 * surfaced only because the film has no displayable theatrical date at all — it is the date the
 * film page itself falls back to, and it gets an explicit "(unconfirmed)" rather than a verb,
 * because reading it as an opening is exactly the mistake NEU-1397 removed from this row.
 *
 * Bucket and country are null by contract when `kind` is `primary`; they are dropped rather
 * than spaced over if they go missing on the other two, so the line never ends in a separator.
 */
export function formatHeadlineRelease(release: HeadlineRelease | null): string {
  if (release === null) return "No date yet";

  const date = formatEventDate(release.date);
  if (release.kind === "primary") return `${date} (unconfirmed)`;

  const parts = [`${release.kind === "upcoming" ? "Opens" : "Opened"} ${date}`];
  if (release.bucket) parts.push(releaseBucketLabel(release.bucket));
  if (release.country) parts.push(release.country);
  return parts.join(" · ");
}
