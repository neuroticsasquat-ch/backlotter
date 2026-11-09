import { describe, expect, it } from "vitest";
import { BrowserTestError, throwIfWorkerTestError, WorkerTestError } from "./test-error";

describe("throwIfWorkerTestError", () => {
  const token = "s3cret";

  it("throws a WorkerTestError when ?__test_error carries the token", () => {
    expect(() =>
      throwIfWorkerTestError(new URL(`https://backlotter.com/?__test_error=${token}`), token),
    ).toThrow(WorkerTestError);
  });

  it("does nothing when ?__test_error carries the wrong value", () => {
    expect(() =>
      throwIfWorkerTestError(new URL("https://backlotter.com/?__test_error=nope"), token),
    ).not.toThrow();
  });

  it("does nothing on a bare ?__test_error, so anyone can't fill Bugsink", () => {
    expect(() =>
      throwIfWorkerTestError(new URL("https://backlotter.com/?__test_error"), token),
    ).not.toThrow();
  });

  it("is off when no token is configured, even for an empty value", () => {
    expect(() =>
      throwIfWorkerTestError(new URL("https://backlotter.com/?__test_error="), undefined),
    ).not.toThrow();
    expect(() =>
      throwIfWorkerTestError(new URL("https://backlotter.com/?__test_error="), ""),
    ).not.toThrow();
  });

  it("does nothing on an ordinary request", () => {
    expect(() =>
      throwIfWorkerTestError(new URL("https://backlotter.com/film/1"), token),
    ).not.toThrow();
  });
});

describe("test error types", () => {
  it("are distinct, so browser and Worker events group as separate Bugsink issues", () => {
    const browser = new BrowserTestError();
    const worker = new WorkerTestError();
    expect(browser.name).toBe("BrowserTestError");
    expect(worker.name).toBe("WorkerTestError");
    expect(browser).not.toBeInstanceOf(WorkerTestError);
    expect(browser.message).toContain("upcoming-movies-frontend");
    expect(worker.message).toContain("upcoming-movies-frontend");
  });
});
