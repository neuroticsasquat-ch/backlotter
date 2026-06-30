import { createRoutesStub } from "react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TermsPage, { meta } from "@/routes/terms";

describe("terms route meta", () => {
  it("sets a Terms-of-Service title and a canonical link", () => {
    const tags = meta({
      location: { pathname: "/terms" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags.some((t) => "title" in t && /Terms of Service/.test(String(t.title)))).toBe(true);
    expect(tags.some((t) => "tagName" in t && t.tagName === "link" && t.rel === "canonical")).toBe(
      true,
    );
  });
});

describe("terms route render", () => {
  it("renders the Terms heading and the last-updated date", async () => {
    const Stub = createRoutesStub([{ path: "/terms", Component: TermsPage }]);
    render(<Stub initialEntries={["/terms"]} />);
    expect(
      await screen.findByRole("heading", { level: 1, name: /terms of service/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/last updated: 2026-06-30/i)).toBeInTheDocument();
  });

  it("links to the privacy policy", async () => {
    const Stub = createRoutesStub([{ path: "/terms", Component: TermsPage }]);
    const { container } = render(<Stub initialEntries={["/terms"]} />);
    await screen.findByRole("heading", { level: 1, name: /terms of service/i });
    expect(container.querySelector('a[href="/privacy"]')).not.toBeNull();
  });
});
