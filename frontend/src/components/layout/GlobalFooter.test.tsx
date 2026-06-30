import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { WORDMARK } from "@/components/layout/nav-items";
import { GlobalFooter } from "@/components/layout/GlobalFooter";

function renderFooter() {
  return render(
    <MemoryRouter>
      <GlobalFooter />
    </MemoryRouter>,
  );
}

describe("GlobalFooter", () => {
  it("renders the wordmark (lowercase)", () => {
    renderFooter();
    expect(screen.getByText(new RegExp(WORDMARK, "i"))).toBeInTheDocument();
  });

  it("renders a copyright line including the current year", () => {
    renderFooter();
    const year = new Date().getUTCFullYear().toString();
    const copyright = screen.getByText(/©\s*\d{4}/);
    expect(copyright).toBeInTheDocument();
    expect(copyright.textContent).toContain(year);
  });

  it("attributes film metadata and images to TMDB with an outbound link", () => {
    renderFooter();
    expect(screen.getByText(/film metadata and images/i)).toBeInTheDocument();
    const tmdb = screen.getByRole("link", { name: /the movie database \(tmdb\)/i });
    expect(tmdb).toHaveAttribute("href", "https://www.themoviedb.org");
    expect(tmdb).toHaveAttribute("target", "_blank");
    expect(tmdb.getAttribute("rel")).toContain("noopener");
  });

  it("no longer renders a footer navigation menu", () => {
    renderFooter();
    expect(screen.queryByRole("navigation", { name: /footer navigation/i })).toBeNull();
  });
});

describe("release credit", () => {
  it("credits neuroticsasquat.ch as the release shop with an outbound link", () => {
    renderFooter();
    const shop = screen.getByRole("link", { name: "neuroticsasquat.ch" });
    expect(shop).toHaveAttribute("href", "https://neuroticsasquat.ch");
    expect(shop).toHaveAttribute("target", "_blank");
    expect(shop.getAttribute("rel")).toContain("noopener");
  });

  it("shows the release credit in the copyright line", () => {
    renderFooter();
    const copyright = screen.getByText(/©\s*\d{4}/);
    expect(copyright.textContent).toMatch(/A\s+neuroticsasquat\.ch\s+release\./);
  });
});

describe("legal links", () => {
  it("links to the Terms of Service page", () => {
    renderFooter();
    expect(screen.getByRole("link", { name: /terms/i })).toHaveAttribute("href", "/terms");
  });

  it("links to the Privacy Policy page", () => {
    renderFooter();
    expect(screen.getByRole("link", { name: /privacy/i })).toHaveAttribute("href", "/privacy");
  });
});
