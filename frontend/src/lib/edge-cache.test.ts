import { describe, expect, it } from "vitest";
import {
  CACHE_STATUS_HEADER,
  entityPageCacheKey,
  isEntityPagePath,
  type PageCache,
  serveEntityPage,
} from "./edge-cache";

const ORIGIN = "https://backlotter.com";
const SHA = "abc1234";
const WITH_HINT = { Cookie: "theme=dark; timeline_hint=1" };

function get(path: string, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, { headers });
}

/** A `caches.default` stand-in keyed on the key's URL, as the Cache API keys a GET. */
function fakeCache() {
  const store = new Map<string, Response>();
  const cache: PageCache = {
    async match(key) {
      return store.get(key.url)?.clone();
    },
    async put(key, response) {
      store.set(key.url, response);
    },
  };
  return { cache, store };
}

/** A `render` that counts its calls and answers with a body naming the call. */
function countingRender(init: ResponseInit = { status: 200 }) {
  let calls = 0;
  const render = async () => {
    calls += 1;
    return new Response(`render ${calls}`, init);
  };
  return { render, calls: () => calls };
}

/** Runs one request through `serveEntityPage` and waits for its background store. */
async function serve(
  request: Request,
  cache: PageCache,
  render: () => Promise<Response>,
  { buildSha }: { buildSha: string | undefined } = { buildSha: SHA },
) {
  const pending: Promise<unknown>[] = [];
  const response = await serveEntityPage(request, {
    cache,
    buildSha,
    waitUntil: (promise) => pending.push(promise),
    render,
  });
  await Promise.all(pending);
  return response;
}

describe("isEntityPagePath", () => {
  it.each(["/film/1-a", "/person/1-a", "/studio/1-a", "/franchise/1-a", "/person/1-a.data"])(
    "matches %s",
    (path) => {
      expect(isEntityPagePath(path)).toBe(true);
    },
  );

  it.each(["/", "/feed", "/calendar/films", "/person/1-a/extra", "/person/", "/people/1-a"])(
    "does not match %s",
    (path) => {
      expect(isEntityPagePath(path)).toBe(false);
    },
  );
});

describe("entityPageCacheKey", () => {
  it("keys on the path and the build SHA, ignoring the query string", () => {
    const plain = entityPageCacheKey(get("/person/1-a"), SHA);
    const tracked = entityPageCacheKey(get("/person/1-a?utm_source=x"), SHA);
    expect(plain?.url).toBe(`${ORIGIN}/person/1-a?v=${SHA}`);
    expect(tracked?.url).toBe(plain?.url);
    expect(plain?.method).toBe("GET");
  });

  it("gives each build its own key", () => {
    expect(entityPageCacheKey(get("/person/1-a"), "1111111")?.url).not.toBe(
      entityPageCacheKey(get("/person/1-a"), "2222222")?.url,
    );
  });

  it.each([
    ["a request carrying the timeline hint", get("/person/1-a", WITH_HINT)],
    ["a POST", new Request(`${ORIGIN}/person/1-a`, { method: "POST" })],
    ["a HEAD", new Request(`${ORIGIN}/person/1-a`, { method: "HEAD" })],
    ["a client-navigation payload", get("/person/1-a.data")],
    ["the feed", get("/feed")],
    ["the home page", get("/")],
    ["a deeper path", get("/person/1-a/extra")],
  ])("bypasses %s", (_, request) => {
    expect(entityPageCacheKey(request, SHA)).toBeNull();
  });

  it("is off without a build SHA", () => {
    expect(entityPageCacheKey(get("/person/1-a"), undefined)).toBeNull();
  });

  it("is off when the build reports a branch name instead of a SHA", () => {
    expect(entityPageCacheKey(get("/person/1-a"), "main")).toBeNull();
  });

  it("does not mistake a similarly named cookie for the hint", () => {
    expect(entityPageCacheKey(get("/person/1-a", { Cookie: "timeline_hints=1" }), SHA)).not.toBe(
      null,
    );
  });
});

describe("serveEntityPage", () => {
  it("renders a page once and serves the repeat load from the cache", async () => {
    const { cache } = fakeCache();
    const { render, calls } = countingRender();

    const first = await serve(get("/person/1-a"), cache, render);
    const second = await serve(get("/person/1-a"), cache, render);

    expect(calls()).toBe(1);
    expect(first.headers.get(CACHE_STATUS_HEADER)).toBe("MISS");
    expect(second.headers.get(CACHE_STATUS_HEADER)).toBe("HIT");
    expect(await first.text()).toBe("render 1");
    expect(await second.text()).toBe("render 1");
  });

  it("renders afresh for a request with the hint and leaves the cache as it was", async () => {
    const { cache, store } = fakeCache();
    const { render, calls } = countingRender();
    await serve(get("/person/1-a"), cache, render);
    const stored = [...store.entries()];

    const withHint = await serve(get("/person/1-a", WITH_HINT), cache, render);

    expect(calls()).toBe(2);
    expect(withHint.headers.get(CACHE_STATUS_HEADER)).toBe("BYPASS");
    expect(await withHint.text()).toBe("render 2");
    expect([...store.entries()]).toEqual(stored);
  });

  it("never serves a render made with the hint to a visitor without it", async () => {
    const { cache, store } = fakeCache();
    const { render, calls } = countingRender();

    await serve(get("/person/1-a", WITH_HINT), cache, render);
    expect(store.size).toBe(0);

    const withoutHint = await serve(get("/person/1-a"), cache, render);
    expect(calls()).toBe(2);
    expect(withoutHint.headers.get(CACHE_STATUS_HEADER)).toBe("MISS");
    expect(await withoutHint.text()).toBe("render 2");
  });

  it.each([404, 301, 500])("does not store a %i", async (status) => {
    const { cache, store } = fakeCache();
    const headers = status === 301 ? { Location: "/person/1-b" } : undefined;
    const { render } = countingRender({ status, headers });

    const response = await serve(get("/person/1-a"), cache, render);

    expect(response.status).toBe(status);
    expect(response.headers.get(CACHE_STATUS_HEADER)).toBe("MISS");
    expect(store.size).toBe(0);
  });

  it("does not store a render for a URL with a query string, but serves it a stored page", async () => {
    const { cache, store } = fakeCache();
    const { render, calls } = countingRender();

    const tracked = await serve(get("/person/1-a?utm_source=x"), cache, render);
    expect(tracked.headers.get(CACHE_STATUS_HEADER)).toBe("MISS");
    expect(store.size).toBe(0);

    await serve(get("/person/1-a"), cache, render);
    const again = await serve(get("/person/1-a?utm_source=x"), cache, render);
    expect(calls()).toBe(2);
    expect(again.headers.get(CACHE_STATUS_HEADER)).toBe("HIT");
    expect(await again.text()).toBe("render 2");
  });

  it("does not store a response that sets a cookie", async () => {
    const { cache, store } = fakeCache();
    const { render } = countingRender({ status: 200, headers: { "Set-Cookie": "a=1" } });

    await serve(get("/person/1-a"), cache, render);

    expect(store.size).toBe(0);
  });

  it("stores the page for an hour but serves the hit without caching headers", async () => {
    const { cache, store } = fakeCache();
    const { render } = countingRender({
      status: 200,
      headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
    });

    const miss = await serve(get("/person/1-a"), cache, render);
    const hit = await serve(get("/person/1-a"), cache, render);

    expect([...store.values()][0].headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(miss.headers.get("Cache-Control")).toBe("no-store");
    expect(hit.headers.has("Cache-Control")).toBe(false);
    expect(hit.headers.get("Content-Type")).toBe("text/html");
  });

  it("answers BYPASS on an entity path when the build has no SHA", async () => {
    const { cache, store } = fakeCache();
    const { render } = countingRender();

    const response = await serve(get("/person/1-a"), cache, render, { buildSha: undefined });

    expect(response.headers.get(CACHE_STATUS_HEADER)).toBe("BYPASS");
    expect(store.size).toBe(0);
  });

  it("leaves a non-entity path untouched", async () => {
    const { cache, store } = fakeCache();
    const { render } = countingRender();

    const response = await serve(get("/feed"), cache, render);

    expect(response.headers.has(CACHE_STATUS_HEADER)).toBe(false);
    expect(store.size).toBe(0);
  });
});
