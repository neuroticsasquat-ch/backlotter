import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { NAV_ITEMS, WORDMARK } from "@/components/layout/nav-items";
import { GlobalFooter } from "@/components/layout/GlobalFooter";

function renderFooter() {
  return render(
    <MemoryRouter>
      <GlobalFooter />
    </MemoryRouter>,
  );
}

describe("GlobalFooter", () => {
  it("renders the wordmark", () => {
    renderFooter();
    expect(screen.getByText(new RegExp(WORDMARK))).toBeInTheDocument();
  });

  it("renders a copyright line including the current year", () => {
    renderFooter();
    const year = new Date().getUTCFullYear().toString();
    const copyright = screen.getByText(/©\s*\d{4}/);
    expect(copyright).toBeInTheDocument();
    expect(copyright.textContent).toContain(year);
  });

  it("renders a link for every enabled nav item and none for disabled ones", () => {
    renderFooter();
    const footerNav = screen.getByRole("navigation", { name: /footer navigation/i });
    for (const item of NAV_ITEMS) {
      const matcher = new RegExp(`^${item.label}$`, "i");
      if (item.enabled) {
        const link = within(footerNav).getByRole("link", { name: matcher });
        expect(link).toHaveAttribute("href", item.href);
      } else {
        // Disabled items have no route — they must not appear as footer links (would 404).
        expect(within(footerNav).queryByRole("link", { name: matcher })).toBeNull();
      }
    }
  });
});
