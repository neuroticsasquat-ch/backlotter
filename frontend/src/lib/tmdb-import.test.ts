import { afterEach, describe, expect, it, vi } from "vitest";
import { readTmdbImport, rememberTmdbImport } from "./tmdb-import";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("tmdb-import", () => {
  it("round-trips the id of the last import", () => {
    rememberTmdbImport("job-1");
    expect(readTmdbImport()).toBe("job-1");
  });

  it("remembers only the most recent one", () => {
    rememberTmdbImport("job-1");
    rememberTmdbImport("job-2");
    expect(readTmdbImport()).toBe("job-2");
  });

  it("reads null when nothing has been imported on this device", () => {
    expect(readTmdbImport()).toBeNull();
  });

  // Both directions are best-effort: a Safari private window throws on the setter, and the
  // panel losing its provenance line must never be what stops an import from being started.
  it("swallows a storage that refuses to write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(() => rememberTmdbImport("job-1")).not.toThrow();
  });

  it("reads null from a storage that refuses to read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    expect(readTmdbImport()).toBeNull();
  });
});
