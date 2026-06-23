import { createRoutesStub } from "react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Preview, { loader, meta } from "@/routes/preview";

describe("preview route", () => {
  it("loader returns the placeholder payload", async () => {
    const data = await loader();
    expect(data).toEqual({ message: "Public SSR is live." });
  });

  it("renders the public preview route from loader data", async () => {
    const Stub = createRoutesStub([{ path: "/preview", Component: Preview, loader }]);
    render(<Stub initialEntries={["/preview"]} />);
    expect(await screen.findByRole("heading", { name: "Public SSR is live." })).toBeInTheDocument();
  });

  it("builds SEO head tags for the public route", () => {
    const tags = meta({ location: { pathname: "/preview" } } as unknown as Parameters<
      typeof meta
    >[0]);
    expect(tags).toContainEqual({ title: "Preview · Upcoming Movies Tracker" });
    expect(tags.some((t) => "name" in t && t.name === "description")).toBe(true);
    expect(tags.some((t) => "property" in t && t.property === "og:title")).toBe(true);
    expect(tags.some((t) => "tagName" in t && t.tagName === "link" && t.rel === "canonical")).toBe(
      true,
    );
  });
});
