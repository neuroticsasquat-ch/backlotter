"""Fire a crawl-shaped load at the person pages and report what came back (NEU-2271, NEU-2286).
Dev-only. Run in the dev container, against the local API or the bench stack:

    task shell
    python scripts/bench_public_burst.py --requests 600 --concurrency 100

    task bench:load -- --refs-file docs/measurements/2026-11-13-neu-2286-incident-refs.csv \
        --endpoint detail --concurrency 30 --warmup 10 --duration 60 --healthz --out ...

Two load shapes:

- **Closed loop** (the default): keep `--concurrency` requests in flight, for `--requests`
  requests or, with `--duration`, for that many seconds after a `--warmup`. This is what finds
  the process's ceiling: requests per second stops rising once the process is saturated.
- **Open loop** (`--rate` or `--arrivals-file`): send requests on a schedule, whatever came
  back, the way a crawl does. `--arrivals-file` replays the per-second arrivals saved from the
  2026-11-13 incident (`docs/measurements/2026-11-13-neu-2286-incident-arrivals.csv`), scaled by
  `--scale`.

Refs come from `--refs-file` (a CSV whose first column is a person ref; no database needed) or
else up to `--people` live refs read from the local database. `--endpoint` picks
`/people/{ref}`, `/people/{ref}/events?limit=20`, or both, alternating per ref (`mixed`).

`--healthz` probes `GET /healthz` once a second on a fresh connection with a 2 s timeout, as
Docker's health check does, and reports each probe's latency and every miss. `--origin-secret`
signs each request as the SSR Worker does, with a client IP rotating over `--visitors`
addresses, so the per-visitor rate limiter sees a spread of visitors as it did in the crawl.

It reports status counts, p50/p95/max latency overall and per status, requests per second
completed in the measured window, and the slowest 503. `--out` also writes all of it as JSON.
"""

import argparse
import asyncio
import calendar
import csv
import ipaddress
import itertools
import json
import random
import statistics
import time
from collections import Counter, defaultdict
from collections.abc import Iterator
from dataclasses import asdict, dataclass, field
from pathlib import Path

import httpx

EVENTS_SUFFIX = "/events?limit=20"
ORIGIN_HEADER = "X-Backlotter-Origin"
CLIENT_IP_HEADER = "X-Backlotter-Client-IP"


@dataclass
class Result:
    path: str
    status: int | str
    started: float
    elapsed: float


@dataclass
class Probe:
    at: float
    latency: float | None  # None: no answer within the timeout
    error: str | None = None


@dataclass
class Run:
    results: list[Result] = field(default_factory=list)
    probes: list[Probe] = field(default_factory=list)


async def load_refs_from_db(limit: int) -> list[str]:
    # Imported here so `--refs-file` needs neither a database nor the app's settings.
    from sqlalchemy import select

    from upmovies.catalog.models import Person
    from upmovies.catalog.ref import person_ref
    from upmovies.db import SessionLocal, engine

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


def load_refs_from_file(path: Path) -> list[str]:
    with path.open(newline="") as fh:
        reader = csv.reader(fh)
        next(reader)  # header
        return [row[0] for row in reader if row and row[0]]


def person_path(ref: str, events: bool) -> str:
    return f"/people/{ref}" + (EVENTS_SUFFIX if events else "")


def closed_loop_paths(refs: list[str], endpoint: str) -> Iterator[str]:
    if endpoint == "mixed":
        paths = [person_path(ref, events) for ref in refs for events in (False, True)]
    else:
        paths = [person_path(ref, endpoint == "events") for ref in refs]
    return itertools.cycle(paths)


def arrival_schedule(args: argparse.Namespace, refs: list[str]) -> list[tuple[float, str]]:
    """Offsets (seconds from the start) and paths for an open-loop run."""
    ref_iter = itertools.cycle(refs)
    schedule: list[tuple[float, str]] = []
    if args.arrivals_file:
        with Path(args.arrivals_file).open(newline="") as fh:
            rows = list(csv.DictReader(fh))
        # Seconds with no arrivals are absent from the file; keep their gaps.
        first = calendar.timegm(time.strptime(rows[0]["second"], "%Y-%m-%dT%H:%M:%SZ"))
        toggle = itertools.cycle((False, True))
        for row in rows:
            second = calendar.timegm(time.strptime(row["second"], "%Y-%m-%dT%H:%M:%SZ")) - first
            # The other routes (companies, films, collections: ~7% in the incident) are sent
            # as person reads, alternating, so the total arrival count is the incident's.
            kinds = (
                [False] * int(row["people_detail"])
                + [True] * int(row["people_events"])
                + [next(toggle) for _ in range(int(row["other"]))]
            )
            kinds = kinds * int(args.scale) + kinds[: round(len(kinds) * (args.scale % 1))]
            random.shuffle(kinds)
            for i, events in enumerate(kinds):
                schedule.append((second + i / len(kinds), person_path(next(ref_iter), events)))
    else:
        paths = closed_loop_paths(refs, args.endpoint)
        count = int(args.rate * args.scale * args.duration)
        schedule = [(i / (args.rate * args.scale), next(paths)) for i in range(count)]
    schedule.sort()
    return schedule


def visitor_ips(count: int) -> list[str]:
    network = ipaddress.ip_network("198.18.0.0/15")  # RFC 2544 benchmarking range
    return [str(network[i + 1]) for i in range(count)]


def request_headers(args: argparse.Namespace, ips: Iterator[str] | None) -> dict[str, str]:
    headers = {"Accept-Encoding": args.accept_encoding}
    if args.origin_secret and ips is not None:
        headers[ORIGIN_HEADER] = args.origin_secret
        headers[CLIENT_IP_HEADER] = next(ips)
    return headers


async def probe_healthz(base_url: str, run: Run, origin: float, stop: asyncio.Event) -> None:
    """GET /healthz once a second, each on a fresh connection with a 2 s timeout."""
    limits = httpx.Limits(max_keepalive_connections=0)
    async with httpx.AsyncClient(base_url=base_url, timeout=2.0, limits=limits) as client:

        async def one(at: float) -> None:
            started = time.perf_counter()
            try:
                response = await client.get("/healthz")
                ok = response.status_code == 200
                run.probes.append(
                    Probe(
                        at, time.perf_counter() - started, None if ok else str(response.status_code)
                    )
                )
            except httpx.HTTPError as exc:
                run.probes.append(Probe(at, None, type(exc).__name__))

        tasks: list[asyncio.Task[None]] = []
        tick = 0
        while not stop.is_set():
            tasks.append(asyncio.create_task(one(time.perf_counter() - origin)))
            tick += 1
            delay = origin + tick - time.perf_counter()
            try:
                await asyncio.wait_for(stop.wait(), timeout=max(delay, 0))
            except TimeoutError:
                pass
        await asyncio.gather(*tasks)


async def send(
    client: httpx.AsyncClient, path: str, headers: dict[str, str], origin: float, run: Run
) -> None:
    started = time.perf_counter()
    try:
        status: int | str = (await client.get(path, headers=headers)).status_code
    except httpx.HTTPError as exc:
        status = type(exc).__name__
    run.results.append(Result(path, status, started - origin, time.perf_counter() - started))


async def closed_loop(
    args: argparse.Namespace, client: httpx.AsyncClient, refs: list[str], run: Run, origin: float
) -> None:
    paths = closed_loop_paths(refs, args.endpoint)
    ips = itertools.cycle(visitor_ips(args.visitors)) if args.origin_secret else None
    remaining = itertools.count() if args.duration else iter(range(args.requests))
    deadline = origin + args.warmup + args.duration if args.duration else None

    async def worker() -> None:
        while next(remaining, None) is not None:
            if deadline is not None and time.perf_counter() >= deadline:
                return
            await send(client, next(paths), request_headers(args, ips), origin, run)

    await asyncio.gather(*(worker() for _ in range(args.concurrency)))


async def open_loop(
    args: argparse.Namespace, client: httpx.AsyncClient, refs: list[str], run: Run, origin: float
) -> None:
    ips = itertools.cycle(visitor_ips(args.visitors)) if args.origin_secret else None
    tasks: list[asyncio.Task[None]] = []
    for offset, path in arrival_schedule(args, refs):
        delay = origin + args.warmup + offset - time.perf_counter()
        if delay > 0:
            await asyncio.sleep(delay)
        tasks.append(
            asyncio.create_task(send(client, path, request_headers(args, ips), origin, run))
        )
    await asyncio.gather(*tasks)


def percentile(values: list[float], pct: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(len(ordered) * pct))]


def latency_summary(values: list[float]) -> dict[str, float | int]:
    if not values:
        return {"n": 0}
    return {
        "n": len(values),
        "p50": statistics.median(values),
        "p95": percentile(values, 0.95),
        "max": max(values),
    }


def summarize(args: argparse.Namespace, run: Run, wall: float) -> dict:
    # Closed loop with --duration: only requests that both started and finished inside the
    # measured window, after the warm-up. Otherwise, every request.
    if args.duration and not (args.rate or args.arrivals_file):
        window_start, window_end = args.warmup, args.warmup + args.duration
        measured = [
            r
            for r in run.results
            if r.started >= window_start and r.started + r.elapsed <= window_end
        ]
        window = args.duration
    else:
        measured = run.results
        window = wall
    statuses = Counter(str(r.status) for r in measured)
    by_status: dict[str, list[float]] = defaultdict(list)
    for r in measured:
        by_status[str(r.status)].append(r.elapsed)
    shed = [(r.elapsed, r.path) for r in measured if r.status == 503]
    # A miss is no answer within the timeout, or an answer that was not a 200.
    answered = [p.latency for p in run.probes if p.latency is not None and p.error is None]
    return {
        "window_s": round(window, 2),
        "wall_s": round(wall, 2),
        "statuses": dict(sorted(statuses.items())),
        "ok_per_s": round(statuses.get("200", 0) / window, 2),
        "all_per_s": round(len(measured) / window, 2),
        "latency": latency_summary([r.elapsed for r in measured]),
        "latency_by_status": {s: latency_summary(v) for s, v in sorted(by_status.items())},
        "slowest_503": max(shed) if shed else None,
        "healthz": {
            "probes": len(run.probes),
            "missed": len(run.probes) - len(answered),
            "worst": max(answered) if answered else None,
            "p50": statistics.median(answered) if answered else None,
        },
    }


def print_summary(args: argparse.Namespace, summary: dict, refs: int) -> None:
    shape = (
        f"open loop, {'arrivals ' + args.arrivals_file if args.arrivals_file else f'{args.rate}/s'}"
        f" x{args.scale}"
        if args.rate or args.arrivals_file
        else f"closed loop, concurrency {args.concurrency}"
    )
    print(
        f"{shape}, endpoint {args.endpoint}, {refs} refs, "
        f"window {summary['window_s']}s, wall {summary['wall_s']}s"
    )
    print("statuses:", ", ".join(f"{s}={n}" for s, n in summary["statuses"].items()))
    for label, lat in [("all", summary["latency"]), *summary["latency_by_status"].items()]:
        if lat["n"]:
            print(
                f"{label:<8} n={lat['n']:<6} p50={lat['p50']:6.3f}s "
                f"p95={lat['p95']:6.3f}s max={lat['max']:6.3f}s"
            )
    print(f"successful requests/s: {summary['ok_per_s']:.1f}")
    if summary["slowest_503"]:
        elapsed, path = summary["slowest_503"]
        print(f"slowest 503: {elapsed:.3f}s {path}")
    h = summary["healthz"]
    if h["probes"]:
        worst = f"{h['worst']:.3f}s" if h["worst"] is not None else "n/a"
        p50 = f"{h['p50']:.3f}s" if h["p50"] is not None else "n/a"
        print(f"healthz: {h['probes']} probes, {h['missed']} missed, p50 {p50}, worst {worst}")


async def main() -> None:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--requests", type=int, default=600)
    parser.add_argument("--concurrency", type=int, default=100)
    parser.add_argument("--people", type=int, default=200)
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--refs-file", help="CSV whose first column is a person ref")
    parser.add_argument("--endpoint", choices=["detail", "events", "mixed"], default="mixed")
    parser.add_argument("--duration", type=float, help="run for this many seconds, not a count")
    parser.add_argument("--warmup", type=float, default=0.0, help="seconds before measuring")
    parser.add_argument("--accept-encoding", default="gzip")
    parser.add_argument("--healthz", action="store_true", help="probe /healthz once a second")
    parser.add_argument("--rate", type=float, help="open loop: requests per second")
    parser.add_argument("--arrivals-file", help="open loop: per-second arrivals CSV to replay")
    parser.add_argument("--scale", type=float, default=1.0, help="open loop: rate multiplier")
    parser.add_argument("--origin-secret", help="sign requests as the SSR Worker does")
    parser.add_argument("--visitors", type=int, default=1000, help="distinct client IPs to rotate")
    parser.add_argument("--label", default="", help="free text, copied into --out")
    parser.add_argument("--out", help="write the summary as JSON here")
    args = parser.parse_args()
    if args.rate and not args.duration:
        parser.error("--rate needs --duration")

    refs = (
        load_refs_from_file(Path(args.refs_file))
        if args.refs_file
        else await load_refs_from_db(args.people)
    )
    if not refs:
        raise SystemExit("no person refs to request")

    run = Run()
    open_shape = bool(args.rate or args.arrivals_file)
    limits = httpx.Limits(max_connections=None if open_shape else args.concurrency)
    stop = asyncio.Event()
    origin = time.perf_counter()
    async with httpx.AsyncClient(
        base_url=args.base_url, timeout=args.timeout, limits=limits
    ) as client:
        prober = (
            asyncio.create_task(probe_healthz(args.base_url, run, origin, stop))
            if args.healthz
            else None
        )
        if open_shape:
            await open_loop(args, client, refs, run, origin)
        else:
            await closed_loop(args, client, refs, run, origin)
        wall = time.perf_counter() - origin - (args.warmup if open_shape else 0.0)
        stop.set()
        if prober is not None:
            await prober

    summary = summarize(args, run, wall)
    print_summary(args, summary, len(refs))
    if args.out:
        out = {
            "label": args.label,
            "args": {k: v for k, v in vars(args).items() if k != "origin_secret"},
            "summary": summary,
            "probes": [asdict(p) for p in run.probes],
        }
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(out, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
