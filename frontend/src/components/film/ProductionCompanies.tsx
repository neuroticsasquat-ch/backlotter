import type { FilmCompany } from "@/api/types";
import { companyTarget } from "@/lib/film-entities";
import { FollowButton } from "@/components/follow/FollowButton";
import { CollapsibleSection } from "./CollapsibleSection";

/** Production companies: a collapsed disclosure (closed by default) that expands
 *  to a vertical list of companies, one per line, each with a follow button
 *  (NEU-1353). Mirrors the cast disclosure.
 *
 *  Takes the companies as objects rather than names because a `company` follow keys on the
 *  TMDB company id; `filmCompanies()` is what turns the film payload into this shape. */
export function ProductionCompanies({ companies }: { companies: FilmCompany[] }) {
  if (companies.length === 0) return null;

  return (
    <CollapsibleSection title="Companies" count={companies.length}>
      <ul>
        {companies.map((company, i) => {
          const target = companyTarget(company);
          return (
            <li
              key={`${company.name}-${i}`}
              className="flex items-center gap-2 rounded px-2 py-0.5 text-sm font-medium odd:bg-muted/40"
            >
              <span className="min-w-0 flex-1">{company.name}</span>
              {target && <FollowButton target={target} />}
            </li>
          );
        })}
      </ul>
    </CollapsibleSection>
  );
}
