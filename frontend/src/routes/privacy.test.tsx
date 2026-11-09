import { createRoutesStub } from "react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PrivacyPage, { meta } from "@/routes/privacy";

describe("privacy route meta", () => {
  it("sets a Privacy-Policy title and a canonical link", () => {
    const tags = meta({
      location: { pathname: "/privacy" },
    } as unknown as Parameters<typeof meta>[0]);
    expect(tags.some((t) => "title" in t && /Privacy Policy/.test(String(t.title)))).toBe(true);
    expect(tags.some((t) => "tagName" in t && t.tagName === "link" && t.rel === "canonical")).toBe(
      true,
    );
  });
});

describe("privacy route render", () => {
  it("renders the Privacy heading and the last-updated date", async () => {
    const Stub = createRoutesStub([{ path: "/privacy", Component: PrivacyPage }]);
    render(<Stub initialEntries={["/privacy"]} />);
    expect(
      await screen.findByRole("heading", { level: 1, name: /privacy policy/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/last updated: 2026-10-11/i)).toBeInTheDocument();
  });

  it("states we do not sell personal information and may sell aggregated data", async () => {
    const Stub = createRoutesStub([{ path: "/privacy", Component: PrivacyPage }]);
    render(<Stub initialEntries={["/privacy"]} />);
    await screen.findByRole("heading", { level: 1, name: /privacy policy/i });
    expect(screen.getByText(/we do not sell, rent, lease, or trade/i)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /aggregated and de-identified data/i }),
    ).toBeInTheDocument();
  });

  it("names the operator by trade name, not a personal name (NEU-1569)", async () => {
    const Stub = createRoutesStub([{ path: "/privacy", Component: PrivacyPage }]);
    const { container } = render(<Stub initialEntries={["/privacy"]} />);
    await screen.findByRole("heading", { level: 1, name: /privacy policy/i });
    expect(container.textContent).toMatch(
      /neuroticsasquat\.ch, a trade name registered in Maryland/,
    );
    expect(container.textContent).not.toMatch(/Tom Boone/);
  });

  it("routes privacy requests to privacy@ (NEU-1569)", async () => {
    const Stub = createRoutesStub([{ path: "/privacy", Component: PrivacyPage }]);
    const { container } = render(<Stub initialEntries={["/privacy"]} />);
    await screen.findByRole("heading", { level: 1, name: /privacy policy/i });
    expect(container.querySelector('a[href="mailto:privacy@backlotter.com"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/support@backlotter\.com/);
  });
});
