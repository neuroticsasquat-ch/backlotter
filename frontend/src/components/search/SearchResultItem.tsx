import { Link } from "react-router";
import type { FilmIndexItem } from "@/api/types";
import { posterUrl } from "@/lib/poster";

interface SearchResultItemProps {
  item: FilmIndexItem;
  isActive: boolean;
  id: string;
}

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
        {item.release_year && (
          <span className="ml-auto text-xs text-muted-foreground">{item.release_year}</span>
        )}
      </Link>
    </li>
  );
}
