"""Break a py-spy profile of the API down by component (NEU-2286, D-2286.6).

Reads `py-spy record --format raw --threads` output (one collapsed stack per line, the thread
first, the sample count last) and assigns each sample of the event-loop thread (`MainThread`) to
a component, by the deepest frame that belongs to one:

    gzip           starlette/middleware/gzip, gzip, zlib
    otel           opentelemetry/
    sentry         sentry_sdk/
    db client      sqlalchemy/, asyncpg/
    serialization  pydantic, fastapi/encoders, json/
    our code       upmovies/
    server/loop    uvicorn/, starlette/, fastapi/, asyncio/, anyio/, logging/
    other          anything else

A sample whose stack ends at `run (asyncio/runners.py)` with nothing above it is the loop in
native code: uvloop's own I/O and httptools' parsing. Record without `--idle`, so a thread
sleeping in epoll is not sampled at all and that line is work, not waiting. Record with
`--full-filenames`: py-spy otherwise shortens a path to its last package, so OTel's
`opentelemetry/instrumentation/sqlalchemy/engine.py` reads as `sqlalchemy/engine.py` and lands in
"db client". `--nonblocking` sampling occasionally garbles a frame name; those bytes are replaced.

Code inside SQLAlchemy's greenlets shows as a stack that starts mid-way (no `runners.py` at its
root); it is still the event-loop thread and is classified the same way.

    python scripts/bench_profile_breakdown.py bench-out/profile.txt
    python scripts/bench_profile_breakdown.py --by-thread bench-out/profile-gil.txt

`--by-thread` instead totals samples per thread group, for a `py-spy record --gil` profile,
where a sample is taken only of the thread holding the GIL: it shows how much of the GIL the
OTel and Sentry background threads take from the loop.
"""

import argparse
import re
from collections import Counter
from pathlib import Path

LOOP_THREAD = "MainThread"
NATIVE_LOOP = "loop native (uvloop, httptools)"

# Checked in order for each frame, so the specific fastapi/encoders beats the general fastapi/.
CATEGORIES: list[tuple[str, tuple[str, ...]]] = [
    ("gzip", ("starlette/middleware/gzip", "gzip.py", "zlib")),
    ("otel", ("opentelemetry/",)),
    ("sentry", ("sentry_sdk/",)),
    ("db client", ("sqlalchemy/", "asyncpg/")),
    ("serialization", ("pydantic", "fastapi/encoders", "json/")),
    ("our code", ("upmovies/",)),
    ("server/loop", ("uvicorn/", "starlette/", "fastapi/", "asyncio/", "anyio/", "logging/")),
]

FRAME_FILE = re.compile(r"\((?P<file>[^():]+)(?::\d+)?\)$")


def parse(path: Path) -> list[tuple[str, list[str], int]]:
    """(thread name, frames root first, sample count) per line."""
    samples = []
    for line in path.read_text(errors="replace").splitlines():
        stack, _, count = line.rpartition(" ")
        if not stack or not count.isdigit():
            continue
        thread, *frames = stack.split(";")
        name = thread.partition(": ")[2] or thread
        samples.append((name, frames, int(count)))
    return samples


def frame_category(frame: str) -> str | None:
    match = FRAME_FILE.search(frame)
    if not match:
        return None
    file = match["file"]
    for name, patterns in CATEGORIES:
        if any(p in file for p in patterns):
            return name
    return None


def classify(frames: list[str]) -> str:
    if frames and frames[-1].startswith("run (") and "asyncio/runners.py" in frames[-1]:
        return NATIVE_LOOP
    for frame in reversed(frames):
        category = frame_category(frame)
        if category is not None:
            return category
    return "other"


def thread_group(name: str, frames: list[str]) -> str:
    if name == LOOP_THREAD:
        return "event loop (MainThread)"
    if name.startswith("Otel") or any("opentelemetry/" in f for f in frames):
        return f"otel: {name}"
    if "sentry" in name.lower() or any("sentry_sdk/worker" in f for f in frames):
        return f"sentry: {name}"
    if name.startswith("AnyIO worker"):
        return "anyio worker threads (sync code off the loop)"
    return f"other: {name}"


def share_table(counts: Counter[str], title: str) -> None:
    total = sum(counts.values())
    print(f"{title}: {total} samples")
    for name, n in counts.most_common():
        print(f"  {name:<48} {n:>7}  {n / total:6.1%}")


def main() -> None:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("profile", type=Path)
    parser.add_argument("--by-thread", action="store_true", help="total per thread group")
    parser.add_argument("--top", type=int, default=12, help="leaf functions to list")
    args = parser.parse_args()

    samples = parse(args.profile)
    if args.by_thread:
        groups: Counter[str] = Counter()
        for name, frames, count in samples:
            groups[thread_group(name, frames)] += count
        share_table(groups, "GIL-holding samples by thread")
        return

    components: Counter[str] = Counter()
    leaves: Counter[str] = Counter()
    for name, frames, count in samples:
        if name != LOOP_THREAD:
            continue
        components[classify(frames)] += count
        leaves[frames[-1] if frames else "?"] += count
    share_table(components, "Event-loop thread, by component")
    print(f"\nTop {args.top} leaf frames on the event-loop thread:")
    total = sum(leaves.values())
    for frame, n in leaves.most_common(args.top):
        print(f"  {n / total:6.1%}  {frame}")


if __name__ == "__main__":
    main()
