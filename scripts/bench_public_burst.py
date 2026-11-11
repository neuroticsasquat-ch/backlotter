"""Fire a crawl-shaped burst at the person pages and report what came back (NEU-2271, D-2271.6).
Dev-only. Run in the container, against the local API:

    task shell
    python scripts/bench_public_burst.py --requests 600 --concurrency 100

It reads up to `--people` live person refs from the local database through `SessionLocal`
(read-only), then sends `--requests` GETs that alternate between `/people/{ref}` and
`/people/{ref}/events`, keeping `--concurrency` in flight. That is the shape of the 2026-11-09/10
Lightpanda crawl, which loaded entity pages from hundreds of IPs at once
(`docs/measurements/2026-11-10-neu-2271-pool-baseline.md`).

It reports status counts, p50/p95/max latency over every request and over each status, the
successful requests per second, and the slowest 503 if there were any.

The local stack is not prod: uvicorn runs with `--reload` against local data. Compare a run on
`main` with a run on a branch, with the same arguments; the absolute numbers mean little.
"""

import argparse
import asyncio
import statistics
import time
from collections import Counter, defaultdict

import httpx
from sqlalchemy import select

from upmovies.catalog.models import Person
from upmovies.catalog.ref import person_ref
from upmovies.db import SessionLocal, engine


async def load_refs(limit: int) -> list[str]:
    async with SessionLocal() as session:
        rows = await session.execute(
            select(Person.id, Person.name)
            .where(Person.tmdb_missing_at.is_(None))
            .order_by(Person.id)
            .limit(limit)
        )
        refs = [person_ref(pid, name) for pid, name in rows]
    await engine.dispose()
    return refs


def percentile(values: list[float], pct: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(len(ordered) * pct))]


def summarize(label: str, values: list[float]) -> str:
    return (
        f"{label:<8} n={len(values):<5} p50={statistics.median(values):6.3f}s "
        f"p95={percentile(values, 0.95):6.3f}s max={max(values):6.3f}s"
    )


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--requests", type=int, default=600)
    parser.add_argument("--concurrency", type=int, default=100)
    parser.add_argument("--people", type=int, default=200)
    parser.add_argument("--timeout", type=float, default=60.0)
    args = parser.parse_args()

    refs = await load_refs(args.people)
    if not refs:
        raise SystemExit("no live people in the local database")
    paths = [
        f"/people/{refs[(i // 2) % len(refs)]}" + ("/events" if i % 2 else "")
        for i in range(args.requests)
    ]

    results: list[tuple[str, int | str, float]] = []
    queue: asyncio.Queue[str] = asyncio.Queue()
    for path in paths:
        queue.put_nowait(path)

    limits = httpx.Limits(max_connections=args.concurrency)
    async with httpx.AsyncClient(
        base_url=args.base_url, timeout=args.timeout, limits=limits
    ) as client:

        async def worker() -> None:
            while True:
                try:
                    path = queue.get_nowait()
                except asyncio.QueueEmpty:
                    return
                started = time.perf_counter()
                try:
                    status: int | str = (await client.get(path)).status_code
                except httpx.HTTPError as exc:
                    status = type(exc).__name__
                results.append((path, status, time.perf_counter() - started))

        started = time.perf_counter()
        await asyncio.gather(*(worker() for _ in range(args.concurrency)))
        wall = time.perf_counter() - started

    statuses = Counter(status for _, status, _ in results)
    by_status: dict[int | str, list[float]] = defaultdict(list)
    for _, status, elapsed in results:
        by_status[status].append(elapsed)

    print(
        f"{args.requests} requests, concurrency {args.concurrency}, "
        f"{len(refs)} people, {wall:.2f}s wall"
    )
    print("statuses:", ", ".join(f"{s}={n}" for s, n in sorted(statuses.items(), key=str)))
    print(summarize("all", [elapsed for _, _, elapsed in results]))
    for status in sorted(by_status, key=str):
        print(summarize(str(status), by_status[status]))
    print(f"successful requests/s: {statuses.get(200, 0) / wall:.1f}")
    shed = [(elapsed, path) for path, status, elapsed in results if status == 503]
    if shed:
        elapsed, path = max(shed)
        print(f"slowest 503: {elapsed:.3f}s {path}")


if __name__ == "__main__":
    asyncio.run(main())
