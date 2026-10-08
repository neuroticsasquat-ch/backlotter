// The theatrical arc — wide + limited — and the US digital home release (D-26 as amended by
// NEU-1542: physical is no longer a bucket).
// Premiere/festival (TMDB type 1) is excluded backend-side, so it never reaches the calendar.
// Short group labels (the date heading above already provides the "release" context); these
// mirror the backend's own bucket labels, which the film page's release rows carry as
// `type_label`, so a film's date reads the same on both surfaces.
export const RELEASE_BUCKET_LABELS: Record<string, string> = {
  limited: "Limited",
  wide: "Wide",
  digital: "Digital",
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
