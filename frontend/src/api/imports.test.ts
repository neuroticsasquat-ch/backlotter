import { describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import { activeImportHandler, makeImportJob } from "@/test/msw/imports";
import { fetchActiveImport } from "./imports";

describe("imports api", () => {
  // TanStack Query rejects a query function that resolves to `undefined`, which is what
  // `apiFetch` makes of a 204 — so "nothing open" has to arrive as `null`.
  it("fetchActiveImport maps the route's 204 to null", async () => {
    server.use(activeImportHandler(null).handler);
    await expect(fetchActiveImport()).resolves.toBeNull();
  });

  it("fetchActiveImport answers the open job when there is one", async () => {
    const job = makeImportJob({ status: "awaiting_review" });
    server.use(activeImportHandler(job).handler);
    await expect(fetchActiveImport()).resolves.toEqual(job);
  });
});
