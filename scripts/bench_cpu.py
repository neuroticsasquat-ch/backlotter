"""A single-core CPU benchmark, for scaling bench numbers to prod (NEU-2286, D-2286.4).

No database and no network: it times the kinds of work a public read does on the event loop
(JSON encoding, gzip at the API's level 6, pydantic validation and serialization, plain Python)
over a synthetic events payload, a fixed number of rounds, best of three. Stdlib and pydantic
only, so it runs unchanged in any of the API's containers. Run it in each and compare totals:

    task bench:cpu                                                     # the bench container
    ssh music-box-dancer 'docker exec -i <backend container> python -' < scripts/bench_cpu.py

Prod's total divided by the bench's is the scale factor. Run it on prod outside the crawl window
(10:15-10:50 UTC); a busy host reads slow.
"""

import gzip
import json
import platform
import time
from datetime import UTC, datetime, timedelta

from pydantic import BaseModel, TypeAdapter

ROUNDS = 1500


class Card(BaseModel):
    id: int
    film_id: int
    event_type: str
    headline: str
    summary: str
    occurred_at: datetime
    sources: list[str]
    tags: dict[str, str]


def payload() -> list[dict]:
    start = datetime(2026, 11, 13, tzinfo=UTC)
    return [
        {
            "id": i,
            "film_id": 1000 + i % 37,
            "event_type": ("casting", "release_date", "trailer", "production")[i % 4],
            "headline": f"Headline number {i} about a film that is coming soon to theaters",
            "summary": ("A summary sentence with some ordinary words in it. " * 6).strip(),
            "occurred_at": (start - timedelta(hours=i)).isoformat(),
            "sources": [f"https://example.com/story/{i}/{j}" for j in range(3)],
            "tags": {"country": "US", "status": "announced", "kind": str(i % 5)},
        }
        for i in range(200)
    ]


def json_round(data: list[dict]) -> bytes:
    return json.dumps(data).encode()


def gzip_round(body: bytes) -> bytes:
    return gzip.compress(body, compresslevel=6)


def pydantic_round(adapter: TypeAdapter[list[Card]], data: list[dict]) -> bytes:
    return adapter.dump_json(adapter.validate_python(data))


def python_round(data: list[dict]) -> int:
    total = 0
    for item in data:
        for key, value in item.items():
            total += len(key) + (len(value) if isinstance(value, str) else 1)
        total += sum(ord(c) for c in item["headline"][:20])
    return total


def timed(fn, *args) -> float:
    best = float("inf")
    for _ in range(3):
        started = time.perf_counter()
        for _ in range(ROUNDS):
            fn(*args)
        best = min(best, time.perf_counter() - started)
    return best


def main() -> None:
    data = payload()
    body = json_round(data)
    adapter = TypeAdapter(list[Card])
    parts = {
        "json": timed(json_round, data),
        "gzip": timed(gzip_round, body),
        "pydantic": timed(pydantic_round, adapter, data),
        "python": timed(python_round, data),
    }
    print(f"python {platform.python_version()} on {platform.machine()}")
    for name, seconds in parts.items():
        print(f"{name:<9} {seconds:7.3f}s")
    print(f"{'total':<9} {sum(parts.values()):7.3f}s")


if __name__ == "__main__":
    main()
