import { describe, expect, it } from "vitest";
import { buildMeta } from "@/lib/seo";

describe("buildMeta", () => {
  it("templates the title and emits description, OG, Twitter, and canonical", () => {
    const tags = buildMeta({
      title: "The Odyssey",
      description: "Epic seafaring.",
      pathname: "/film/the-odyssey-2026",
    });

    expect(tags).toContainEqual({ title: "The Odyssey · BackLotter" });
    expect(tags).toContainEqual({ name: "description", content: "Epic seafaring." });
    expect(tags).toContainEqual({
      property: "og:title",
      content: "The Odyssey · BackLotter",
    });
    expect(tags).toContainEqual({ property: "og:description", content: "Epic seafaring." });
    expect(tags).toContainEqual({ property: "og:type", content: "website" });
    expect(tags).toContainEqual({ property: "og:site_name", content: "BackLotter" });
    expect(tags).toContainEqual({ name: "twitter:card", content: "summary" });

    const canonical = tags.find((t) => "tagName" in t && t.tagName === "link") as
      | { tagName: "link"; rel: string; href: string }
      | undefined;
    expect(canonical?.rel).toBe("canonical");
    expect(canonical?.href).toMatch(/\/film\/the-odyssey-2026$/);
  });

  it("falls back to the site name and default description when omitted", () => {
    const tags = buildMeta({ pathname: "/" });
    expect(tags).toContainEqual({ title: "BackLotter" });
    expect(tags.some((t) => "name" in t && t.name === "description")).toBe(true);
    expect(tags.find((t) => "property" in t && t.property === "og:image")).toBeUndefined();
  });

  it("adds image tags and upgrades the Twitter card when an image is given", () => {
    const tags = buildMeta({
      title: "X",
      pathname: "/x",
      image: "https://img.example/poster.jpg",
    });
    expect(tags).toContainEqual({
      property: "og:image",
      content: "https://img.example/poster.jpg",
    });
    expect(tags).toContainEqual({
      name: "twitter:image",
      content: "https://img.example/poster.jpg",
    });
    expect(tags).toContainEqual({ name: "twitter:card", content: "summary_large_image" });
  });
});
