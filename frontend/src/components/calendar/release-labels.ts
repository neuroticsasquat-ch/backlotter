export const RELEASE_BUCKET_LABELS: Record<string, string> = {
  premiere: "Premiere",
  limited: "Limited release",
  wide: "Wide release",
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
