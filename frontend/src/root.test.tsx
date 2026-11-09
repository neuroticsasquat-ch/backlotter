import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/react";
import * as RR from "react-router";
import { ErrorBoundary, Layout } from "./root";

vi.mock("@sentry/react", () => ({ captureException: vi.fn() }));
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof RR>();
  return {
    ...actual,
    isRouteErrorResponse: vi.fn(actual.isRouteErrorResponse),
    // Layout's head is the unit under test. These four all reach for router context the
    // test has no business standing up, and none of them contributes an asserted tag.
    Meta: () => null,
    Links: () => null,
    ScrollRestoration: () => null,
    Scripts: () => null,
  };
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

describe("root Layout head", () => {
  // Layout renders <html>, which jsdom will not nest inside a container — render it to a
  // string instead of mounting it.
  const markup = () =>
    renderToStaticMarkup(
      <Layout>
        <div />
      </Layout>,
    );

  it("links the web app manifest", () => {
    expect(markup()).toContain('rel="manifest"');
    expect(markup()).toContain('href="/manifest.webmanifest"');
  });

  it("sets the theme colour Chrome's install banner reads", () => {
    expect(markup()).toContain('name="theme-color" content="#0f172a"');
  });

  it("carries the Apple standalone metas", () => {
    // Belt-and-braces below the manifest for iOS versions before 16.4. Chrome warns on
    // the apple-prefixed capability tag alone, so the standardised spelling ships too.
    expect(markup()).toContain('name="mobile-web-app-capable" content="yes"');
    expect(markup()).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(markup()).toContain('name="apple-mobile-web-app-status-bar-style" content="black"');
    expect(markup()).toContain('name="apple-mobile-web-app-title" content="backlotter"');
  });
});
