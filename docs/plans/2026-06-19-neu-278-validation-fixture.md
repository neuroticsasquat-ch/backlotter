# NEU-278: Labeled validation fixture (current corpus) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A committed, self-contained labeled validation set drawn from the current story corpus — the ground truth the NEU-279 accuracy baseline measures against.

**Architecture:** A JSON fixture where each item embeds the story text (so it's portable, independent of local DB ids) plus its label: the correct film (keyed by **TMDB id**, stable across DBs), the `about`/`mention`/`none` relation, and (for `about` items) the expected `event_type`. A typed Pydantic loader validates it. A small export helper dumps recent DB stories into a draft for hand-labeling.

**Tech Stack:** Pydantic v2, SQLAlchemy 2 async (export helper), pytest.

**Repo:** `upcoming-movies-backend` · **Branch:** `tom/neu-278-be-labeled-validation-fixture-current-corpus` · **Spec:** `docs/specs/2026-06-19-entity-linking-clustering-design.md`

**Depends on:** nothing (can start immediately, in parallel with M1). The labeling itself is manual.

> **Commit/PR convention:** No per-step commits — implement, run the checks, then the user commits once and opens the PR. All commands run in the container via `task`.

---

## File Structure

- **Create** `src/upmovies/link/validation.py` — `ValidationItem`, `load_validation_set`.
- **Create** `tests/unit/link/test_validation.py` — loader + schema tests.
- **Create** `scripts/export_link_validation_draft.py` — DB → draft JSON for hand-labeling.
- **Create** `tests/fixtures/link/validation_set.json` — the labeled set (filled in manually).
- **Create** `tests/fixtures/link/README.md` — labeling protocol.

---

### Task 1: Fixture schema + loader

**Files:**
- Create: `src/upmovies/link/validation.py`
- Test: `tests/unit/link/test_validation.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/link/test_validation.py`:

```python
import json

import pytest
from pydantic import ValidationError

from upmovies.link.validation import ValidationItem, load_validation_set


def _item(**overrides) -> dict:
    base = {
        "url": "https://e/1",
        "source": "Deadline",
        "title": "Runner gets a trailer",
        "summary": "First look at the sci-fi thriller.",
        "relation": "about",
        "expected_film_tmdb_id": 123,
        "event_type": "trailer",
    }
    base.update(overrides)
    return base


def test_loads_valid_items(tmp_path):
    path = tmp_path / "set.json"
    path.write_text(json.dumps([_item(), _item(url="https://e/2", relation="none",
                                             expected_film_tmdb_id=None, event_type=None)]))
    items = load_validation_set(path)
    assert len(items) == 2
    assert items[0].expected_film_tmdb_id == 123
    assert items[1].relation == "none"


def test_about_requires_a_film_id(tmp_path):
    path = tmp_path / "set.json"
    path.write_text(json.dumps([_item(expected_film_tmdb_id=None)]))  # about but no film
    with pytest.raises(ValidationError):
        load_validation_set(path)


def test_rejects_unknown_relation():
    with pytest.raises(ValidationError):
        ValidationItem(url="u", source="s", title="t", summary="", relation="maybe")
```

- [ ] **Step 2: Run them to verify they fail**

Run: `task test -- tests/unit/link/test_validation.py`
Expected: FAIL — `upmovies.link.validation` does not exist.

- [ ] **Step 3: Implement `validation.py`**

Create `src/upmovies/link/validation.py`:

```python
"""The labeled validation set for measuring linking/clustering accuracy. Self-contained:
each item embeds the story text plus its label, keyed to films by TMDB id (stable across
databases) rather than local uuids."""

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, model_validator


class ValidationItem(BaseModel):
    url: str
    source: str
    title: str
    summary: str = ""
    relation: Literal["about", "mention", "none"]
    expected_film_tmdb_id: int | None = None
    event_type: str | None = None
    event_group: str | None = None  # free-text group label for cluster scoring (about items)

    @model_validator(mode="after")
    def _check_consistency(self) -> "ValidationItem":
        if self.relation == "about" and self.expected_film_tmdb_id is None:
            raise ValueError("an 'about' item must set expected_film_tmdb_id")
        if self.relation != "about" and self.expected_film_tmdb_id is not None:
            raise ValueError("only 'about' items may set expected_film_tmdb_id")
        return self


def load_validation_set(path: str | Path) -> list[ValidationItem]:
    data = json.loads(Path(path).read_text())
    return [ValidationItem.model_validate(row) for row in data]
```

- [ ] **Step 4: Run them to verify they pass**

Run: `task test -- tests/unit/link/test_validation.py`
Expected: PASS (3 tests).

---

### Task 2: Export helper for hand-labeling

**Files:**
- Create: `scripts/export_link_validation_draft.py`

- [ ] **Step 1: Write the export script**

Create `scripts/export_link_validation_draft.py`:

```python
"""Dump recent stories into a draft validation file for hand-labeling. Run in the
container: `task shell` then `python scripts/export_link_validation_draft.py > \
tests/fixtures/link/validation_draft.json`. Fill in relation / expected_film_tmdb_id / \
event_type by hand, then save as validation_set.json."""

import asyncio
import json
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from upmovies.db import SessionLocal
from upmovies.news.models import Story

RECENCY_DAYS = 45


async def main() -> None:
    cutoff = datetime.now(UTC) - timedelta(days=RECENCY_DAYS)
    async with SessionLocal() as s:
        rows = (
            await s.execute(
                select(Story)
                .where(func.coalesce(Story.published_at, Story.fetched_at) >= cutoff)
                .order_by(Story.source, Story.title)
            )
        ).scalars().all()
    draft = [
        {
            "url": row.url,
            "source": row.source,
            "title": row.title,
            "summary": (row.raw.get("summary", "") if isinstance(row.raw, dict) else ""),
            "relation": "TODO",  # about | mention | none
            "expected_film_tmdb_id": None,  # required iff relation == about
            "event_type": None,  # required iff relation == about
            "event_group": None,  # optional cluster label
        }
        for row in rows
    ]
    print(json.dumps(draft, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Smoke-test it runs**

Run: `task shell`, then `python scripts/export_link_validation_draft.py | head -c 200` (exit the shell after). Expected: a JSON array prints (content depends on the local corpus).

---

### Task 3: Produce the labeled fixture + README (manual)

**Files:**
- Create: `tests/fixtures/link/validation_set.json`
- Create: `tests/fixtures/link/README.md`

- [ ] **Step 1: Generate + hand-label**

Run the export helper to a draft, then **hand-label** ~150–200 items: every plausible film-title match plus a representative reject sample. For each: set `relation` (`about`/`mention`/`none`); for `about`, set `expected_film_tmdb_id` (the TMDB id of the tracked film) and `event_type`; optionally set `event_group` (a short shared label across stories about the same beat, e.g. `"runner-trailer-1"`) to enable cluster scoring. Save as `tests/fixtures/link/validation_set.json`.

- [ ] **Step 2: Validate the labeled file loads**

Run: `task shell`, then `python -c "from upmovies.link.validation import load_validation_set; print(len(load_validation_set('tests/fixtures/link/validation_set.json')))"` (exit after). Expected: prints the item count with no `ValidationError`.

- [ ] **Step 3: Write the README**

Create `tests/fixtures/link/README.md` documenting: the schema, the `about`/`mention`/`none` distinction (mirroring the linker prompt), the TMDB-id keying, the sampling (all plausible matches + a reject sample), and the `event_group` convention. Note that the set was drawn from the corpus as of the labeling date.

---

## Final verification (before handing off to commit)

- [ ] `task format`
- [ ] `task lint` — clean
- [ ] `task typecheck` — clean
- [ ] `task test` — full suite green
- [ ] Hand off: the user commits (e.g. `test: add labeled link/cluster validation fixture`) and opens the PR for NEU-278.

---

## Self-Review

- **Spec coverage:** Delivers the labeled set (correct film by TMDB id, `about`/`mention`/`none`, `event_type`, optional `event_group`) drawn from the current corpus, with a typed loader and an export helper — the substrate NEU-279 measures against. Matches the spec's "Validation harness & accuracy baseline → Labeled set".
- **Placeholders:** The `validation_set.json` content is intentionally produced by manual labeling (the only non-automatable part); the schema, loader, tests, and export tooling are all concrete.
- **Type consistency:** `ValidationItem(url, source, title, summary, relation, expected_film_tmdb_id, event_type, event_group)` and `load_validation_set(path) -> list[ValidationItem]` are used identically in the loader, tests, and the NEU-279 harness.
