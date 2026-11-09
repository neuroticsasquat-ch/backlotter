import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { SearchResultItem } from "@/components/search/SearchResultItem";
import type { SearchHit } from "@/components/search/useDebouncedSearch";

const hit: SearchHit = {
  key: "film-the-odyssey-2026",
  label: "The Odyssey",
  to: "/film/the-odyssey-2026",
  imagePath: "/odyssey.jpg",
  imageKind: "poster",
  detail: "2026",
};

function renderItem(overrides: Partial<SearchHit> = {}) {
  render(
    <MemoryRouter>
      <SearchResultItem item={{ ...hit, ...overrides }} isActive={false} id="option-0" />
    </MemoryRouter>,
  );
}

describe("SearchResultItem", () => {
  it("links to the hit's own page and shows its name and trailing detail", () => {
    renderItem();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/film/the-odyssey-2026");
    expect(screen.getByText("The Odyssey")).toBeInTheDocument();
    expect(screen.getByText("2026")).toBeInTheDocument();
  });

  it("renders a hit of any type at the URL it carries", () => {
    renderItem({ to: "/studio/41-a24", label: "A24", detail: "US", imageKind: "logo" });
    expect(screen.getByRole("link")).toHaveAttribute("href", "/studio/41-a24");
    expect(screen.getByText("A24")).toBeInTheDocument();
    expect(screen.getByText("US")).toBeInTheDocument();
  });

  it("renders no trailing detail for a hit that has none", () => {
    const { container } = render(
      <MemoryRouter>
        <SearchResultItem
          item={{ ...hit, label: "Star Wars Collection", detail: null }}
          isActive={false}
          id="option-0"
        />
      </MemoryRouter>,
    );
    expect(container.querySelectorAll("span")).toHaveLength(1);
  });

  it("the image is decorative — a name is never announced twice", () => {
    renderItem();
    const img = screen.getByRole("link").querySelector("img");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("aria-hidden");
  });

  it("renders no image for a hit that has none", () => {
    renderItem({ imagePath: null });
    expect(screen.getByRole("link").querySelector("img")).toBeNull();
  });

  it("shapes a profile as a circle, and a logo uncropped — a wordmark loses its name to a crop", () => {
    renderItem({ imageKind: "profile", imagePath: "/nolan.jpg" });
    expect(screen.getByRole("link").querySelector("img")).toHaveClass("rounded-full");

    renderItem({ imageKind: "logo", imagePath: "/a24.png" });
    expect(screen.getAllByRole("link")[1].querySelector("img")).toHaveClass("object-contain");
  });
});
