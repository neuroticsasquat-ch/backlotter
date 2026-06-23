import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ArcStepper } from "@/components/film/ArcStepper";

describe("ArcStepper", () => {
  it("renders all seven named stages", () => {
    render(<ArcStepper current="trailer" />);
    for (const label of [
      "Announced",
      "Cast",
      "Shooting",
      "Wrapped",
      "Dated",
      "Trailer",
      "Released",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("highlights exactly the current stage", () => {
    render(<ArcStepper current="trailer" />);
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(screen.getByText("Trailer")).toHaveClass("text-blue-600");
    expect(screen.getByText("Cast")).not.toHaveClass("text-blue-600");
  });
});
