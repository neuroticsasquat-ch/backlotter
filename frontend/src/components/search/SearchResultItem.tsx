import { Link } from "react-router";
import type { FilmIndexItem } from "@/api/types";
import { arcStageLabel } from "@/components/film/labels";
import { posterUrl } from "@/lib/poster";

interface SearchResultItemProps {
  item: FilmIndexItem;
  isActive: boolean;
  id: string;
}

/** One search result: poster, title, and the release year — or, for an undated
 *  film, its arc-stage label ("Announced") in the same trailing slot. */
export function SearchResultItem({ item, isActive, id }: SearchResultItemProps) {
  return (
    <li id={id} role="option" aria-selected={isActive} className={isActive ? "bg-accent" : ""}>
      <Link
        to={`/film/${item.slug}`}
        tabIndex={-1}
        className="flex items-center gap-3 px-3 py-2 hover:bg-accent"
      >
        {item.poster_path && (
          <img
            src={posterUrl(item.poster_path, "w92") ?? ""}
            alt=""
            aria-hidden
            className="h-12 w-8 flex-shrink-0 rounded object-cover"
          />
        )}
        <span className="truncate text-sm">{item.title}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {item.release_year ?? arcStageLabel(item.arc_stage)}
        </span>
      </Link>
    </li>
  );
}
