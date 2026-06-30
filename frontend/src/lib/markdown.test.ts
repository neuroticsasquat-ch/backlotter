import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/lib/markdown";

describe("renderMarkdown", () => {
  it("converts a heading to an <h1>", () => {
    expect(renderMarkdown("# Hello")).toContain("<h1>Hello</h1>");
  });

  it("converts a bullet list to <ul><li>", () => {
    const html = renderMarkdown("- one\n- two");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });

  it("renders paragraphs", () => {
    expect(renderMarkdown("a paragraph")).toContain("<p>a paragraph</p>");
  });

  it("preserves links", () => {
    const html = renderMarkdown("[Privacy](/privacy)");
    expect(html).toContain('href="/privacy"');
  });
});
