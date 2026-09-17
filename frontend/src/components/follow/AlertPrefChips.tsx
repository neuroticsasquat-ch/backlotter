import { useUpdateAlertPrefs } from "@/api/me";
import type { AlertPref } from "@/api/types";

/** The three availability beats a watchlist item can alert on (D-14), in the order the backend
 *  canonicalises them so the row reads the same however the set was built. */
const PREFS: { pref: AlertPref; label: string }[] = [
  { pref: "buy", label: "Buy" },
  { pref: "rent", label: "Rent" },
  { pref: "stream", label: "Stream" },
];

/**
 * Per-item alert preferences as toggle chips.
 *
 * Only the *availability* beats are a choice. The push-whitelist beats — a date assigned or
 * moved, a home-release date, a trailer — are always on for a watchlist item (D-14), so there
 * is deliberately nothing here to switch them off with. The page's standfirst says as much, so
 * the absence reads as a rule rather than as a missing control.
 *
 * Turning all three off is a real setting, not an empty state: it means "tell me when the date
 * moves, but not when it lands on a store".
 */
export function AlertPrefChips({
  filmId,
  title,
  prefs,
}: {
  filmId: string;
  title: string;
  prefs: AlertPref[];
}) {
  const update = useUpdateAlertPrefs();

  const toggle = (pref: AlertPref) => {
    const next = prefs.includes(pref) ? prefs.filter((p) => p !== pref) : [...prefs, pref];
    // Canonical order, matching the backend's `normalise_alert_prefs`, so the optimistic list
    // and the one that comes back from the refetch are the same array rather than the same set
    // in two orders.
    const ordered = PREFS.map((p) => p.pref).filter((p) => next.includes(p));
    update.mutate({ filmId, alertPrefs: ordered });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PREFS.map(({ pref, label }) => {
        const on = prefs.includes(pref);
        return (
          <button
            key={pref}
            type="button"
            // `aria-pressed` rather than a checkbox role: these are toggle buttons that act
            // immediately, and a screen reader should hear "pressed", not "checked" with an
            // implied form to submit.
            aria-pressed={on}
            aria-label={`${label} alerts for ${title}`}
            disabled={update.isPending}
            onClick={() => toggle(pref)}
            className={
              on
                ? "rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                : "rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
