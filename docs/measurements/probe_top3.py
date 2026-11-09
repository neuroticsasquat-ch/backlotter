"""Re-run the undated-candidate probe with the cast cut at top-3 instead of top-5.

Read-only, against the frozen pre-expansion local snapshot, so the output is directly
comparable to 2026-08-11-undated-probe-pre-directors-flip.csv. Patches the two names the
sweep's seed module actually reads at call time — `seeds.TOP_BILLED_ORDER` (the SQL that
picks seed people) and `seeds.is_top_billed` (the role check on the candidate film) —
rather than editing catalog/seed_grade.py, which the credit-history writer shares.
"""

import asyncio
import logging
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, "/app")

import upmovies.ingest.sweep.seeds as seeds

NEW_ORDER = 3
seeds.TOP_BILLED_ORDER = NEW_ORDER
seeds.is_top_billed = lambda o: o is not None and o < NEW_ORDER

from scripts.probe_undated_candidates import run_probe  # noqa: E402
from upmovies.config import get_settings  # noqa: E402
from upmovies.db import SessionLocal  # noqa: E402
from upmovies.ingest.tmdb.client import TMDBClient  # noqa: E402

log = logging.getLogger("probe_top3")


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    settings = get_settings()
    log.info("cast cut at top-%d", NEW_ORDER)
    async with TMDBClient(
        base_url=settings.tmdb_base_url,
        api_key=settings.tmdb_api_key,
        rate_calls=settings.tmdb_rate_limit_requests,
        rate_window=settings.tmdb_rate_limit_window_seconds,
        retry_max_attempts=settings.tmdb_retry_max_attempts,
    ) as client:
        summary = await run_probe(
            session_factory=SessionLocal,
            client=client,
            out_path=Path("/tmp/undated_probe_top3.csv"),
            today=date.today(),
            excluded_statuses=settings.tmdb_excluded_statuses,
            dormancy_days=settings.sweep_dormancy_days,
        )
    log.info("done: %s", summary)


if __name__ == "__main__":
    asyncio.run(main())
