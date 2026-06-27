import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/react";
import * as RR from "react-router";
import { ErrorBoundary } from "./root";

vi.mock("@sentry/react", () => ({ captureException: vi.fn() }));
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof RR>();
  return { ...actual, isRouteErrorResponse: vi.fn(actual.isRouteErrorResponse) };
});

describe("root ErrorBoundary", () => {
  afterEach(() => vi.clearAllMocks());

  it("reports unexpected runtime errors to Sentry", () => {
    render(<ErrorBoundary error={new Error("boom")} />);
    expect(Sentry.captureException).toHaveBeenCalledOnce();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("does not report ordinary 404s", () => {
    vi.mocked(RR.isRouteErrorResponse).mockReturnValueOnce(true);
    render(<ErrorBoundary error={{ status: 404, statusText: "Not Found" }} />);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(screen.getByText("404 Not Found")).toBeInTheDocument();
  });

  it("reports 5xx route errors", () => {
    vi.mocked(RR.isRouteErrorResponse).mockReturnValueOnce(true);
    render(<ErrorBoundary error={{ status: 500, statusText: "Internal Server Error" }} />);
    expect(Sentry.captureException).toHaveBeenCalledOnce();
  });
});
