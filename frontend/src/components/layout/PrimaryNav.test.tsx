import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { NAV_ITEMS } from "@/components/layout/nav-items";
import { PrimaryNav } from "@/components/layout/PrimaryNav";

function renderPrimaryNav(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <PrimaryNav />
    </MemoryRouter>,
  );
}

describe("PrimaryNav", () => {
  it("renders enabled items as links with correct hrefs", () => {
    renderPrimaryNav();
    for (const item of NAV_ITEMS) {
      if (!item.enabled) continue;
      const link = screen.getByRole("link", { name: new RegExp(item.label, "i") });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", item.href);
    }
  });

  it("renders disabled items as non-link elements with aria-disabled", () => {
    renderPrimaryNav();
    for (const item of NAV_ITEMS) {
      if (item.enabled) continue;
      // Should NOT be a link
      expect(screen.queryByRole("link", { name: new RegExp(item.label, "i") })).toBeNull();
      // Should be present as text with aria-disabled
      const el = screen.getByText(new RegExp(item.label, "i"));
      expect(el).toHaveAttribute("aria-disabled", "true");
      expect(el).not.toHaveAttribute("href");
    }
  });

  it("disabled items are not focusable via keyboard (tabIndex -1)", () => {
    renderPrimaryNav();
    for (const item of NAV_ITEMS) {
      if (item.enabled) continue;
      const el = screen.getByText(new RegExp(item.label, "i"));
      expect(el).toHaveAttribute("tabindex", "-1");
    }
  });
});
