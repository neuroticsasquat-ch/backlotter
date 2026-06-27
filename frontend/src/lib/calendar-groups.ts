import type { CalendarItem } from "@/api/types";
import { formatDayHeading } from "@/lib/format";
import { releaseBucketLabel } from "@/components/calendar/release-labels";

export interface CalendarBucketGroup {
  bucket: string; // "premiere" | "limited" | "wide"
  label: string; // releaseBucketLabel(bucket)
  films: CalendarItem[];
}

export interface CalendarDateGroup {
  dateKey: string; // "YYYY-MM-DD" — stable React key + <time dateTime>
  heading: string; // formatDayHeading(release_date), UTC, e.g. "Saturday, July 4, 2026"
  buckets: CalendarBucketGroup[];
}

/**
 * Bucket a backend-ordered calendar items list (`release_date ASC`, then `release_type ASC`)
 * into per-date sections, with per-bucket sub-groups. Preserving the backend order means
 * dates come out in input order (soonest-first) with a deterministic within-date bucket order.
 * No sorting, no `Date.now()`, so SSR and client output match.
 *
 * Uses an adjacency walk (like `groupByDay`) over two levels: date, then bucket.
 */
export function groupByReleaseDate(items: CalendarItem[]): CalendarDateGroup[] {
  const dateGroups: CalendarDateGroup[] = [];

  for (const item of items) {
    const lastDateGroup = dateGroups[dateGroups.length - 1];

    // Check if we need to open a new date section
    if (!lastDateGroup || lastDateGroup.dateKey !== item.release_date) {
      dateGroups.push({
        dateKey: item.release_date,
        heading: formatDayHeading(item.release_date),
        buckets: [
          {
            bucket: item.release_type,
            label: releaseBucketLabel(item.release_type),
            films: [item],
          },
        ],
      });
    } else {
      // Same date — check if we need to open a new bucket within this date
      const lastBucket = lastDateGroup.buckets[lastDateGroup.buckets.length - 1];
      if (lastBucket.bucket === item.release_type) {
        // Same bucket — append the film
        lastBucket.films.push(item);
      } else {
        // New bucket — create a new bucket group
        lastDateGroup.buckets.push({
          bucket: item.release_type,
          label: releaseBucketLabel(item.release_type),
          films: [item],
        });
      }
    }
  }

  return dateGroups;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export interface CalendarMonthGroup {
  monthKey: string; // "YYYY-MM" — stable React key
  heading: string; // month name, e.g. "June"
  days: CalendarDateGroup[];
}

export interface CalendarYearGroup {
  year: string; // "YYYY" — heading + stable React key
  months: CalendarMonthGroup[];
}

/**
 * Nest already-ordered per-date groups (from groupByReleaseDate) under month and year via an
 * adjacency walk. Year/month are parsed straight off the "YYYY-MM-DD" dateKey string (no Date),
 * so SSR and client output match. Order is preserved (soonest-first).
 */
export function nestByYearMonth(dateGroups: CalendarDateGroup[]): CalendarYearGroup[] {
  const years: CalendarYearGroup[] = [];
  for (const day of dateGroups) {
    const year = day.dateKey.slice(0, 4);
    const monthKey = day.dateKey.slice(0, 7);
    const monthIdx = Number(day.dateKey.slice(5, 7)) - 1;

    let lastYear = years[years.length - 1];
    if (!lastYear || lastYear.year !== year) {
      lastYear = { year, months: [] };
      years.push(lastYear);
    }
    let lastMonth = lastYear.months[lastYear.months.length - 1];
    if (!lastMonth || lastMonth.monthKey !== monthKey) {
      lastMonth = { monthKey, heading: MONTH_NAMES[monthIdx], days: [] };
      lastYear.months.push(lastMonth);
    }
    lastMonth.days.push(day);
  }
  return years;
}
