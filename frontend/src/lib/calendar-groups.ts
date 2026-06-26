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
