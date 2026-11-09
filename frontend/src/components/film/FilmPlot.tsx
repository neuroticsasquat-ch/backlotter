import { CollapsibleSection } from "./CollapsibleSection";

/** Plot summary: a collapsed disclosure (closed by default) that expands to the film's
 *  overview text. Hidden entirely when there is no overview. */
export function FilmPlot({ overview }: { overview: string | null }) {
  if (!overview) return null;

  return (
    <CollapsibleSection title="Plot" railed={false}>
      <p className="px-2 text-sm leading-relaxed text-foreground">{overview}</p>
    </CollapsibleSection>
  );
}
