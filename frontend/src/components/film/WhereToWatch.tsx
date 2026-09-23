import type { WatchProvider, WhereToWatchBox } from "@/api/types";
import { logoUrl } from "@/lib/poster";
import { JustWatchAttribution } from "./JustWatchAttribution";

/** The monetization buckets in the order the box lists them: the one a reader may already be
 *  paying for, then the two that cost money today. The labels are the alert settings'
 *  vocabulary (D-14, D-44) — "Stream" for TMDB's `flatrate` — so the word means the same thing
 *  on both surfaces. */
const MONETIZATION_ROWS: readonly { key: "flatrate" | "rent" | "buy"; label: string }[] = [
  { key: "flatrate", label: "Stream" },
  { key: "rent", label: "Rent" },
  { key: "buy", label: "Buy" },
];

/** One provider: its TMDB logo where there is one, and its name either way. The logo is
 *  decorative (`alt=""`) because the name sits beside it — an alt would read it twice. */
function ProviderChip({ provider }: { provider: WatchProvider }) {
  const logo = logoUrl(provider.logo_path);
  return (
    <li className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs font-medium">
      {logo && (
        <img src={logo} alt="" width={16} height={16} loading="lazy" className="h-4 w-4 rounded" />
      )}
      {provider.name}
    </li>
  );
}

/**
 * Where to watch (D-29): the film's current US providers, grouped by how the reader pays, with
 * the JustWatch credit and the link back to TMDB that TMDB's terms require.
 *
 * A snapshot, never a history — it says where the film is today and nothing about where it used
 * to be. Renders nothing at all when the box is absent (no poll has reached this film) *or*
 * when every bucket is empty: a heading over a bare JustWatch credit would attribute a provider
 * list that isn't on screen.
 */
export function WhereToWatch({ box }: { box?: WhereToWatchBox | null }) {
  if (!box) return null;

  const rows = MONETIZATION_ROWS.map((row) => ({ ...row, providers: box[row.key] })).filter(
    (row) => row.providers.length > 0,
  );
  if (rows.length === 0) return null;

  return (
    <section className="border-t border-border pb-4 pt-3">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Where to watch</h2>
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">
          {box.region}
        </span>
      </div>
      <dl className="mt-3 space-y-3">
        {rows.map((row) => (
          <div key={row.key}>
            <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
            <dd className="mt-1">
              <ul className="flex flex-wrap items-center gap-2">
                {row.providers.map((provider) => (
                  <ProviderChip key={provider.id} provider={provider} />
                ))}
              </ul>
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-3">
        <JustWatchAttribution link={box.link} />
      </div>
    </section>
  );
}
