import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { env } from "@/env";
import { installFakeTurnstile, TEST_TURNSTILE_TOKEN, type FakeTurnstile } from "@/test/turnstile";
import { Turnstile } from "./Turnstile";

describe("Turnstile", () => {
  let turnstile: FakeTurnstile;

  beforeEach(() => {
    turnstile = installFakeTurnstile({ autoSolve: false });
  });
  afterEach(() => turnstile.uninstall());

  it("renders the widget with the configured site key", async () => {
    render(<Turnstile onToken={() => {}} />);
    await waitFor(() => expect(turnstile.renderCount()).toBe(1));
    expect(turnstile.sitekey()).toBe(env.turnstileSiteKey);
    expect(screen.getByTestId("turnstile")).toBeInTheDocument();
  });

  it("hands the solved token up", async () => {
    const onToken = vi.fn();
    render(<Turnstile onToken={onToken} />);
    await waitFor(() => expect(turnstile.renderCount()).toBe(1));
    turnstile.solve();
    expect(onToken).toHaveBeenCalledWith(TEST_TURNSTILE_TOKEN);
  });

  it("clears the token when the challenge expires", async () => {
    const onToken = vi.fn();
    render(<Turnstile onToken={onToken} />);
    await waitFor(() => expect(turnstile.renderCount()).toBe(1));
    turnstile.solve();
    turnstile.expire();
    expect(onToken).toHaveBeenLastCalledWith(null);
  });

  it("reports an errored challenge as unavailable, with no token", async () => {
    const onToken = vi.fn();
    const onUnavailable = vi.fn();
    render(<Turnstile onToken={onToken} onUnavailable={onUnavailable} />);
    await waitFor(() => expect(turnstile.renderCount()).toBe(1));
    turnstile.fail();
    expect(onToken).toHaveBeenLastCalledWith(null);
    expect(onUnavailable).toHaveBeenCalled();
  });

  it("raises a fresh challenge when remounted under a new key", async () => {
    const { rerender } = render(<Turnstile key="a" onToken={() => {}} />);
    await waitFor(() => expect(turnstile.renderCount()).toBe(1));
    rerender(<Turnstile key="b" onToken={() => {}} />);
    await waitFor(() => expect(turnstile.renderCount()).toBe(2));
  });

  it("does not re-raise the challenge when the parent re-renders", async () => {
    const { rerender } = render(<Turnstile onToken={() => {}} />);
    await waitFor(() => expect(turnstile.renderCount()).toBe(1));
    rerender(<Turnstile onToken={() => {}} />);
    await waitFor(() => expect(turnstile.renderCount()).toBe(1));
  });
});

describe("Turnstile without a site key", () => {
  let turnstile: FakeTurnstile;

  beforeEach(() => {
    turnstile = installFakeTurnstile({ autoSolve: false });
    // Production build with VITE_TURNSTILE_SITE_KEY unset: `env.ts` leaves it empty rather
    // than falling back to the always-passes test key.
    vi.spyOn(env, "turnstileSiteKey", "get").mockReturnValue("");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    turnstile.uninstall();
    vi.restoreAllMocks();
  });

  it("renders no widget and reports itself unavailable", async () => {
    const onUnavailable = vi.fn();
    render(<Turnstile onToken={() => {}} onUnavailable={onUnavailable} />);
    await waitFor(() => expect(onUnavailable).toHaveBeenCalled());
    expect(turnstile.renderCount()).toBe(0);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("VITE_TURNSTILE_SITE_KEY"));
  });
});
