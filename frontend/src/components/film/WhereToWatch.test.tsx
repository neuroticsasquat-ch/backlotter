import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WhereToWatch } from "@/components/film/WhereToWatch";
import type { WhereToWatchBox } from "@/api/types";

/** A film carried on all three monetization types, one provider missing its logo. */
const box: WhereToWatchBox = {
  region: "US",
  flatrate: [{ id: 8, name: "Netflix", logo_path: "/netflix.jpg" }],
  rent: [
    { id: 2, name: "Apple TV", logo_path: "/appletv.jpg" },
    { id: 10, name: "Amazon Video", logo_path: null },
  ],
  buy: [{ id: 2, name: "Apple TV", logo_path: "/appletv.jpg" }],
  link: "https://www.themoviedb.org/movie/603/watch?locale=US",
  attribution: "JustWatch",
};

/** The section's own subtree, so a "Buy" assertion can't match a provider name elsewhere. */
function boxSection() {
  return screen.getByRole("heading", { name: /where to watch/i }).closest("section")!;
}

describe("WhereToWatch", () => {
  it("renders nothing when the film has no where-to-watch data", () => {
    const { container } = render(<WhereToWatch box={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the backend omits the field entirely", () => {
    const { container } = render(<WhereToWatch box={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  // An empty box is a box with nothing to attribute — rendering the heading and a bare
  // JustWatch credit would claim a provider list that isn't there.
  it("renders nothing when every monetization bucket is empty", () => {
    const { container } = render(
      <WhereToWatch box={{ ...box, flatrate: [], rent: [], buy: [] }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("groups providers under their monetization label", () => {
    render(<WhereToWatch box={box} />);
    const section = within(boxSection());
    expect(section.getByText("Stream")).toBeInTheDocument();
    expect(section.getByText("Rent")).toBeInTheDocument();
    expect(section.getByText("Buy")).toBeInTheDocument();
    expect(section.getByText("Netflix")).toBeInTheDocument();
    expect(section.getByText("Amazon Video")).toBeInTheDocument();
    // Apple TV carries the film on two buckets and is listed under each.
    expect(section.getAllByText("Apple TV")).toHaveLength(2);
  });

  it("omits a monetization label whose bucket is empty", () => {
    render(<WhereToWatch box={{ ...box, rent: [], buy: [] }} />);
    const section = within(boxSection());
    expect(section.getByText("Stream")).toBeInTheDocument();
    expect(section.queryByText("Rent")).toBeNull();
    expect(section.queryByText("Buy")).toBeNull();
  });

  it("renders a TMDB logo per provider that has one, decorative beside its name", () => {
    render(<WhereToWatch box={box} />);
    const logos = within(boxSection()).getAllByRole("presentation", { hidden: true });
    // Three of the four provider entries have a logo_path; Amazon Video has none.
    expect(logos).toHaveLength(3);
    expect(logos[0]).toHaveAttribute("src", "https://image.tmdb.org/t/p/w92/netflix.jpg");
  });

  it("names a provider with no logo anyway", () => {
    render(<WhereToWatch box={{ ...box, flatrate: [], rent: [], buy: box.rent.slice(1) }} />);
    const section = within(boxSection());
    expect(section.getByText("Amazon Video")).toBeInTheDocument();
    expect(section.queryAllByRole("presentation", { hidden: true })).toHaveLength(0);
  });

  it("shows the region the availability applies to", () => {
    render(<WhereToWatch box={box} />);
    expect(within(boxSection()).getByText("US")).toBeInTheDocument();
  });

  // TMDB's terms for the providers endpoint: credit JustWatch wherever the data renders, and
  // link back to TMDB's own watch page. Neither is decoration, so both are asserted.
  it("credits JustWatch and links out to TMDB's watch page", () => {
    render(<WhereToWatch box={box} />);
    const section = within(boxSection());
    expect(section.getByText(/JustWatch/)).toBeInTheDocument();
    const link = section.getByRole("link", { name: /TMDB/i });
    expect(link).toHaveAttribute("href", box.link);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("still credits JustWatch when TMDB gives no link for the region", () => {
    render(<WhereToWatch box={{ ...box, link: null }} />);
    const section = within(boxSection());
    expect(section.getByText(/JustWatch/)).toBeInTheDocument();
    expect(section.queryByRole("link")).toBeNull();
  });
});
