import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SourceLinks } from "@/components/film/SourceLinks";

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
});
