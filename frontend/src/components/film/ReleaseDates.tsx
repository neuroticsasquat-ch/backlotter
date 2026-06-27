import type { ReleaseDate } from "@/api/types";
import { formatEventDate } from "@/lib/format";

/** Release dates section: a list of TMDB release date entries for a film. */
export function ReleaseDates({ dates }: { dates: ReleaseDate[] }) {
  if (dates.length === 0) return null;

  const showCountry = new Set(dates.map((d) => d.country)).size > 1;

  return (
    <section className="border-t border-border pb-4 pt-3">
      <h2 className="text-lg font-semibold">Release dates</h2>
      <ul className="mt-3 space-y-2">
        {dates.map((d) => (
          <li
            key={`${d.country}-${d.release_type}-${d.date}`}
            className="flex flex-wrap items-center gap-2 text-sm"
          >
            <span className="font-medium">{d.type_label}</span>
            <time dateTime={d.date} className="text-muted-foreground">
              {formatEventDate(d.date)}
            </time>
            {showCountry && (
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">
                {d.country}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
