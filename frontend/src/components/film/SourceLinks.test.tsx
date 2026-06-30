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
      />,
    );
    const link = screen.getByRole("link", { name: "Deadline" });
    expect(link).toHaveAttribute("href", "https://deadline.com/a");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("renders nothing when there are no sources", () => {
    const { container } = render(<SourceLinks sources={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows no delink control without admin props", () => {
    render(<SourceLinks sources={delinkSources} />);
    expect(screen.queryByRole("button", { name: /delink/i })).toBeNull();
  });

  it("calls onDelink with the source url when admin", () => {
    const onDelink = vi.fn();
    render(<SourceLinks sources={delinkSources} admin onDelink={onDelink} />);
    fireEvent.click(screen.getByRole("button", { name: /delink ScreenRant/i }));
    expect(onDelink).toHaveBeenCalledWith("https://x.test/a");
  });
});
