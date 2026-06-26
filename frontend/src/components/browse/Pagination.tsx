import { Link, useSearchParams } from "react-router";

interface PaginationProps {
  page: number;
  totalPages: number;
}

/**
 * Crawlable Prev/Next pagination, path-agnostic via relative `?…` links.
 * Preserves any other query params already on the URL (e.g. `q` on /search) and
 * only swaps `page`, so paging never drops the active search term.
 * Returns null (no nav) when totalPages <= 1.
 */
export function Pagination({ page, totalPages }: PaginationProps) {
  const showNav = totalPages > 1;
  const [searchParams] = useSearchParams();

  function pageHref(n: number): string {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(n));
    return `?${params.toString()}`;
  }

  return (
    <nav aria-label="Pagination" className="flex items-center justify-center gap-4 py-4">
      {showNav && page > 1 ? (
        <Link
          to={pageHref(page - 1)}
          className="rounded px-3 py-1 text-sm font-medium hover:underline"
        >
          Prev
        </Link>
      ) : showNav ? (
        <span aria-disabled="true" className="rounded px-3 py-1 text-sm font-medium text-gray-400">
          Prev
        </span>
      ) : null}

      <span className="text-sm text-gray-600">
        Page {page} of {totalPages}
      </span>

      {showNav && page < totalPages ? (
        <Link
          to={pageHref(page + 1)}
          className="rounded px-3 py-1 text-sm font-medium hover:underline"
        >
          Next
        </Link>
      ) : showNav ? (
        <span aria-disabled="true" className="rounded px-3 py-1 text-sm font-medium text-gray-400">
          Next
        </span>
      ) : null}
    </nav>
  );
}
