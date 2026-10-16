import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorTest } from "./ErrorTest";

describe("ErrorTest", () => {
  it("offers a button that throws the browser test error", () => {
    render(<ErrorTest />);
    expect(screen.getByRole("button", { name: /throw test error/i })).toBeInTheDocument();
  });
});
