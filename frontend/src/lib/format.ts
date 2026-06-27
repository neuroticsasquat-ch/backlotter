import type { ReleaseDate } from "@/api/types";

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
