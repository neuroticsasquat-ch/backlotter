/** Known errors thrown on demand to confirm a deploy reports to Bugsink (NEU-1594). Two
 *  classes, so the browser and Worker test events group as separate Bugsink issues and each
 *  can be told apart from a real error by its type alone. */
export class BrowserTestError extends Error {
  constructor() {
    super("upcoming-movies-frontend browser test error: thrown on purpose from /debug/error");
    this.name = "BrowserTestError";
  }
}

export class WorkerTestError extends Error {
  constructor() {
    super("upcoming-movies-frontend Worker test error: thrown on purpose by ?__test_error");
    this.name = "WorkerTestError";
  }
}

/** Query parameter that makes the Worker throw a `WorkerTestError` before routing. */
export const WORKER_TEST_ERROR_PARAM = "__test_error";

/** Throws a `WorkerTestError` when `?__test_error` carries `token`, the Worker's
 *  `SENTRY_TEST_ERROR_TOKEN` secret. Guarded so nobody else can fill Bugsink with test events;
 *  with no token configured the trigger is off. */
export function throwIfWorkerTestError(url: URL, token: string | undefined): void {
  if (token && url.searchParams.get(WORKER_TEST_ERROR_PARAM) === token) {
    throw new WorkerTestError();
  }
}
