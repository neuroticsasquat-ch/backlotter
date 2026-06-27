import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FilmPlot } from "@/components/film/FilmPlot";

describe("FilmPlot", () => {
  it("renders the Plot heading and the overview text", () => {
    render(<FilmPlot overview="A gripping story unfolds." />);
    expect(screen.getByRole("heading", { name: "Plot" })).toBeInTheDocument();
    expect(screen.getByText("A gripping story unfolds.")).toBeInTheDocument();
  });

  it("renders nothing when overview is null", () => {
    const { container } = render(<FilmPlot overview={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when overview is an empty string", () => {
    const { container } = render(<FilmPlot overview="" />);
    expect(container).toBeEmptyDOMElement();
  });
});
