import type { CalendarItem } from "@/api/types";
import { groupByReleaseDate, nestByYearMonth } from "@/lib/calendar-groups";
import { CalendarFilmRow } from "@/components/calendar/CalendarFilmRow";

/**
 * The year → month → date → bucket body of a calendar: one section per year, with sticky year
 * and month headings above a dated list of release buckets.
 *
 * Shared by the all-releases calendar and the reader's watchlist calendar, which render the
 * same DTO — `/me/calendar` answers with `/calendar`'s exact shape (NEU-1411) — so the two
 * differ in what they fetch and never in how a date looks.
 */
export function CalendarDateGroups({ items }: { items: CalendarItem[] }) {
  const years = nestByYearMonth(groupByReleaseDate(items));
  return (
    <>
      {years.map((year) => (
        <section key={year.year} className="mt-8">
          <h2 className="sticky top-0 z-20 bg-background py-1 text-xl font-bold">{year.year}</h2>
          {year.months.map((month) => (
            <div key={month.monthKey} className="mt-4">
              <h3 className="sticky top-8 z-10 bg-background py-1 text-sm font-semibold text-muted-foreground">
                {month.heading}
              </h3>
              {month.days.map((group) => (
                <section key={group.dateKey} className="mt-4">
                  <h4 className="text-sm font-medium text-muted-foreground">
                    <time dateTime={group.dateKey}>{group.heading}</time>
                  </h4>
                  <div className="mt-2 space-y-3 border-l-2 border-border pl-3">
                    {group.buckets.map((bucket) => (
                      <div key={bucket.bucket}>
                        <h5 className="mb-1 text-xs font-medium text-muted-foreground">
                          {bucket.label}
                        </h5>
                        <div>
                          {bucket.films.map((f) => (
                            <CalendarFilmRow item={f} key={f.film_ref} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ))}
        </section>
      ))}
    </>
  );
}
