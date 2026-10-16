import { describe, expect, it } from "vitest";
import { BrowserTestError, throwIfWorkerTestError, WorkerTestError } from "./test-error";

describe("throwIfWorkerTestError", () => {
  it("throws a WorkerTestError when the URL carries ?__test_error", () => {
    expect(() => throwIfWorkerTestError(new URL("https://backlotter.com/?__test_error"))).toThrow(
      WorkerTestError,
    );
  });

  it("does nothing on an ordinary request", () => {
    expect(() => throwIfWorkerTestError(new URL("https://backlotter.com/film/1"))).not.toThrow();
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
