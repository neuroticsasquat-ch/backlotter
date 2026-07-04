import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ArcStepper } from "@/components/film/ArcStepper";

describe("ArcStepper", () => {
  it("renders exactly the four reachable stages", () => {
    render(<ArcStepper current="wrapped" />);
    for (const label of ["Announced", "Shooting", "Wrapped", "Released"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("does not render removed stages", () => {
    render(<ArcStepper current="wrapped" />);
    for (const label of ["Cast", "Dated", "Trailer"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it("highlights exactly the current stage with text-blue-400", () => {
    render(<ArcStepper current="wrapped" />);
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(screen.getByText("Wrapped")).toHaveClass("text-blue-400");
  });

  it("does not highlight non-current stages", () => {
    render(<ArcStepper current="wrapped" />);
    expect(screen.getByText("Announced")).not.toHaveClass("text-blue-400");
    expect(screen.getByText("Shooting")).not.toHaveClass("text-blue-400");
    expect(screen.getByText("Released")).not.toHaveClass("text-blue-400");
  });
});
