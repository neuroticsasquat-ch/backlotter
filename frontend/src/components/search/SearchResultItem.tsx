import { Link } from "react-router";
import { logoUrl, posterUrl, profileUrl } from "@/lib/poster";
import type { SearchHit } from "./useDebouncedSearch";

interface SearchResultItemProps {
  item: SearchHit;
  isActive: boolean;
  id: string;
}

/** The three image families the dropdown shows, each at the shape TMDB serves it in: a 2:3
 *  poster, a square-cropped profile, a logo that must not be cropped at all (a wordmark loses
 *  its name to `object-cover`). */
const IMAGE: Record<
  SearchHit["imageKind"],
  { url: (path: string) => string | null; className: string }
> = {
  poster: { url: (path) => posterUrl(path, "w92"), className: "h-12 w-8 rounded object-cover" },
  profile: {
    url: (path) => profileUrl(path, "w92"),
    className: "h-10 w-10 rounded-full object-cover",
  },
  logo: {
    url: (path) => logoUrl(path),
    className: "h-8 w-10 rounded bg-white object-contain p-0.5",
  },
};

/** One search result: its image, its name, and a trailing detail — a release year, a
 *  department, an origin country — where the entity has one. */
export function SearchResultItem({ item, isActive, id }: SearchResultItemProps) {
  const image = IMAGE[item.imageKind];
  const src = item.imagePath ? image.url(item.imagePath) : null;

  return (
    <li id={id} role="option" aria-selected={isActive} className={isActive ? "bg-accent" : ""}>
      <Link
        to={item.to}
        tabIndex={-1}
        className="flex items-center gap-3 px-3 py-2 hover:bg-accent"
      >
        {src && <img src={src} alt="" aria-hidden className={`flex-shrink-0 ${image.className}`} />}
        <span className="truncate text-sm">{item.label}</span>
        {item.detail && (
          <span className="ml-auto text-xs text-muted-foreground">{item.detail}</span>
        )}
      </Link>
    </li>
  );
}
