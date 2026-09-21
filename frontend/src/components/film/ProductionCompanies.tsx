import { Link } from "react-router";
import type { FilmCompany } from "@/api/types";
import { companyTarget, studioPath } from "@/lib/film-entities";
import { FollowButton } from "@/components/follow/FollowButton";
import { CollapsibleSection } from "./CollapsibleSection";

/** Production companies: a collapsed disclosure (closed by default) that expands
 *  to a vertical list of companies, one per line, each linking to its studio page and
 *  carrying a follow button (NEU-1353, NEU-1429). Mirrors the cast disclosure.
 *
 *  Takes the companies as objects rather than names because a `company` follow keys on the
 *  TMDB company id; `filmCompanies()` is what turns the film payload into this shape. A
 *  names-only entry has no id, so it gets neither the link nor the button — the same branch,
 *  once, through {@link companyTarget}, rather than a second test here that could mint a link
 *  to `/studio/undefined`. The button stays until M3's film-page ticket takes every entity
 *  button off this page. */
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
              <span className="min-w-0 flex-1">
                {target ? (
                  <Link to={studioPath(target.entityId, target.label)} className="hover:underline">
                    {company.name}
                  </Link>
                ) : (
                  company.name
                )}
              </span>
              {target && <FollowButton target={target} />}
            </li>
          );
        })}
      </ul>
    </CollapsibleSection>
  );
}
