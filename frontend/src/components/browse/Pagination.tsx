import { Link } from "react-router";

interface PaginationProps {
  page: number;
  totalPages: number;
}

/**
 * Crawlable Prev/Next pagination for the /browse page.
 * Uses relative `?page=N` links so the component is path-agnostic.
 * Returns null (no nav) when totalPages <= 1.
 */
export function Pagination({ page, totalPages }: PaginationProps) {
  const showNav = totalPages > 1;

  return (
    <nav aria-label="Pagination" className="flex items-center justify-center gap-4 py-4">
      {showNav && page > 1 ? (
        <Link
          to={`?page=${page - 1}`}
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
          to={`?page=${page + 1}`}
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
