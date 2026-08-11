import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SourceLinks } from "@/components/film/SourceLinks";

const delinkSources = [
  { url: "https://x.test/a", source: "ScreenRant", title: "t", published_at: null },
];

describe("SourceLinks", () => {
  it("renders outbound source links", () => {
    render(
      <SourceLinks
        sources={[
          { url: "https://deadline.com/a", source: "Deadline", title: "Cast", published_at: null },
        ]}
        provenance="story"
      />,
    );
    const link = screen.getByRole("link", { name: "Deadline" });
    expect(link).toHaveAttribute("href", "https://deadline.com/a");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("renders nothing for a source-less story event", () => {
    const { container } = render(<SourceLinks sources={[]} provenance="story" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows no delink control without admin props", () => {
    render(<SourceLinks sources={delinkSources} provenance="story" />);
    expect(screen.queryByRole("button", { name: /delink/i })).toBeNull();
  });

  it("calls onDelink with the source url when admin", () => {
    const onDelink = vi.fn();
    render(<SourceLinks sources={delinkSources} provenance="story" admin onDelink={onDelink} />);
    fireEvent.click(screen.getByRole("button", { name: /delink ScreenRant/i }));
    expect(onDelink).toHaveBeenCalledWith("https://x.test/a");
  });

  it("attributes a source-less catalog event to TMDB", () => {
    render(<SourceLinks sources={[]} provenance="catalog" />);
    expect(screen.getByText("via TMDB")).toBeInTheDocument();
  });

  it("renders the outlets, not the TMDB fallback, once a catalog event gains sources", () => {
    render(<SourceLinks sources={delinkSources} provenance="catalog" />);
    expect(screen.getByRole("link", { name: "ScreenRant" })).toBeInTheDocument();
    expect(screen.queryByText("via TMDB")).toBeNull();
  });
});
