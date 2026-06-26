import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { Pagination } from "@/components/browse/Pagination";

function renderPagination(page: number, totalPages: number) {
  render(
    <MemoryRouter initialEntries={["/browse"]}>
      <Pagination page={page} totalPages={totalPages} />
    </MemoryRouter>,
  );
}

describe("Pagination", () => {
  describe("middle page (page=2, totalPages=5)", () => {
    it("shows a Prev link to ?page=1", () => {
      renderPagination(2, 5);
      const prev = screen.getByRole("link", { name: /prev/i });
      expect(prev).toHaveAttribute("href", "/browse?page=1");
    });

    it("shows a Next link to ?page=3", () => {
      renderPagination(2, 5);
      const next = screen.getByRole("link", { name: /next/i });
      expect(next).toHaveAttribute("href", "/browse?page=3");
    });

    it("shows the page label", () => {
      renderPagination(2, 5);
      expect(screen.getByText("Page 2 of 5")).toBeInTheDocument();
    });
  });

  describe("first page (page=1, totalPages=3)", () => {
    it("does not show a Prev link", () => {
      renderPagination(1, 3);
      expect(screen.getByText(/prev/i)).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /prev/i })).toBeNull();
    });

    it("shows a Next link to ?page=2", () => {
      renderPagination(1, 3);
      const next = screen.getByRole("link", { name: /next/i });
      expect(next).toHaveAttribute("href", "/browse?page=2");
    });

    it("shows the page label", () => {
      renderPagination(1, 3);
      expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    });
  });

  describe("last page (page=5, totalPages=5)", () => {
    it("shows a Prev link to ?page=4", () => {
      renderPagination(5, 5);
      const prev = screen.getByRole("link", { name: /prev/i });
      expect(prev).toHaveAttribute("href", "/browse?page=4");
    });

    it("does not show a Next link", () => {
      renderPagination(5, 5);
      expect(screen.getByText(/next/i)).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /next/i })).toBeNull();
    });

    it("shows the page label", () => {
      renderPagination(5, 5);
      expect(screen.getByText("Page 5 of 5")).toBeInTheDocument();
    });
  });

  describe("single page (totalPages=1)", () => {
    it("shows no Prev link", () => {
      renderPagination(1, 1);
      expect(screen.queryByRole("link", { name: /prev/i })).toBeNull();
    });

    it("shows no Next link", () => {
      renderPagination(1, 1);
      expect(screen.queryByRole("link", { name: /next/i })).toBeNull();
    });
  });

  describe("zero total pages", () => {
    it("shows no Prev or Next links", () => {
      renderPagination(1, 0);
      expect(screen.queryByRole("link", { name: /prev/i })).toBeNull();
      expect(screen.queryByRole("link", { name: /next/i })).toBeNull();
    });
  });
});
