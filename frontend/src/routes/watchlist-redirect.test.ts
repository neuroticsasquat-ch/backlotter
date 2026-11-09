import { describe, expect, it } from "vitest";
import routes from "@/routes";
import { loader } from "@/routes/watchlist-redirect";

describe("/me/watchlist", () => {
  it("is the route the address is wired to", () => {
    // The loader below is only reached if `routes.ts` still points this path at this module —
    // a wrong module path there would leave every other assertion here passing against a page
    // nothing serves.
    const entry = routes.find((r) => r.path === "me/watchlist");

    expect(entry?.file).toBe("routes/watchlist-redirect.ts");
  });

  it("redirects to the follows page", () => {
    const response = loader();

    // A real 3xx from the server, not a client-side bounce: a crawler holding a stale link is
    // told where the page went (EF-14).
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/me/follows");
  });

  it("redirects temporarily, so the target is not frozen in every browser cache", () => {
    // 301 would be cached indefinitely and pin this destination forever; the page was never
    // indexed, so the permanence would buy nothing to set against that.
    expect(loader().status).not.toBe(301);
  });

  it("lands on the whole list rather than pre-selecting the Films chip", () => {
    // `MyFollows` keeps the lit chips in `localStorage` and reads no search parameter, so a
    // `?type=films` here would be inert rather than useful.
    expect(loader().headers.get("Location")).not.toContain("?");
  });
});
