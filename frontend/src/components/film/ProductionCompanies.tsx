import { CollapsibleSection } from "./CollapsibleSection";

/** Production companies: a collapsed disclosure (closed by default) that expands
 *  to a vertical list of companies, one per line. Mirrors the cast disclosure. */
export function ProductionCompanies({ companies }: { companies: string[] }) {
  if (companies.length === 0) return null;

  return (
    <CollapsibleSection title="Companies" count={companies.length}>
      <ul>
        {companies.map((company, i) => (
          <li
            key={`${company}-${i}`}
            className="rounded px-2 py-0.5 text-sm font-medium odd:bg-muted/40"
          >
            {company}
          </li>
        ))}
      </ul>
    </CollapsibleSection>
  );
}
