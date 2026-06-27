// Only the theatrical arc is surfaced — wide + limited. Premiere/festival (TMDB type 1) is
// excluded backend-side, so it never reaches the calendar. Short "Wide" / "Limited" group
// labels (the date heading above already provides the "release" context).
export const RELEASE_BUCKET_LABELS: Record<string, string> = {
  limited: "Limited",
  wide: "Wide",
};

/**
 * Map a release bucket to its human-readable label.
 * Falls back to a Title-Cased form of the bucket for unknown values.
 */
export function releaseBucketLabel(bucket: string): string {
  if (bucket in RELEASE_BUCKET_LABELS) {
    return RELEASE_BUCKET_LABELS[bucket];
  }
  // Fallback: Title case the raw value
  return bucket
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
