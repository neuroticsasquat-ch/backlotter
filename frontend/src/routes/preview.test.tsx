import { createRoutesStub } from "react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Preview, { loader } from "@/routes/preview";

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
});
