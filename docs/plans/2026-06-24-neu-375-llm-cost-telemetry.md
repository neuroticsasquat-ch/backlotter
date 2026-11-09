# NEU-375 — Per-run LLM Cost Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the `Usage` (input / output / cache-read / cache-creation tokens) that the link, cluster, and summarize LLM calls currently throw away, aggregate it per stage across a whole ingest run, price it in dollars from a single shared helper, persist one row per `(run, stage)` in a new `ingest.run_llm_usage` table, and surface the per-stage tokens + cost through the `/admin/runs` API. This is the foundation ticket: five sibling tickets (NEU-376/377/378/379/380) consume the exact stage labels, table shape, pricing module, and recording helper built here.

**Architecture:** A new pricing module (`llm/pricing.py`) becomes the single source of truth for the cost math (lifted verbatim from `scripts/measure_link_cost.py`, which is then refactored to import it). A new ORM model `RunLLMUsage` + Alembic migration stores per-stage aggregates. A recording helper `record_llm_usage` sits beside `create_run`/`finalize_run` in `ingest/runs.py` and UPSERTs a `(run_id, stage)` row. The three summarization/link/cluster service functions stop discarding usage — they switch their internal `complete()` to `complete_with_usage()` and return `(Result, Usage)`; the batch paths already carry `BatchResult.usage`, so the pipelines aggregate it. `run_link_ingest` emits two stage rows (`"link"`, `"cluster"`); `run_synthesize_ingest` emits one (`"summarize"`). DTOs (`RunLLMUsageOut`, `RunOut.llm_usage`) plus a `selectinload` in `admin_runs.py` expose the data without N+1.

**Tech Stack:** Python 3.13, SQLAlchemy 2 (async) + asyncpg, Alembic, Pydantic v2, pytest (pytest-asyncio auto mode). **All tooling runs in the container via `task`** — never run `pytest`/`ruff`/`pyright`/`alembic`/`python` on the host.

## Global Constraints

- **One backend PR**, on branch `tom/neu-375-backend-capture-persist-per-stage-llm-token-usage-cost-on`.
- **Container-only tooling:** `task up`, `task test` (scope with `task test -- <path>`), `task lint` (`ruff check src tests`), `task format` (`ruff format src tests`), `task typecheck` (`pyright src tests`), `task migrate` (`alembic upgrade head`), `task makemigration -- "msg"`, `task shell`. `task build` **only** after a `pyproject.toml` change (none here). Keep the container up.
- **Migration flow:** add the ORM model/columns FIRST (tests pick up the schema via `create_all` in `tests/conftest.py`), then `task makemigration -- "msg"`, review the generated file by hand, then `task migrate`.
- **TDD:** write the failing test first, watch it fail with the expected message, then write the minimal implementation. pytest-asyncio is in `auto` mode (no `@pytest.mark.asyncio` decorator). Integration tests use the `session` fixture against the test DB; after a Core-level upsert, re-read rows with `execution_options={"populate_existing": True}`.
- **Style:** modern type hints (`X | None`, `X | Y`); **no** `from __future__ import annotations`; ruff line length 100 (rules E,F,W,I,B,UP); `import x as x` re-export pattern in `__init__.py`.
- **Pre-commit hooks delegate into Docker** — commit normally, **no `--no-verify`**. Run `task format` *before* staging so the format-check hook passes.
- **Before claiming done:** `task test`, `task lint`, `task typecheck` all green (and `task format` applied).
- **Commit message:** Conventional Commits subject, **no** Linear ID in the subject (optional `Refs NEU-375.` in body), **no** `🤖 Generated with Claude Code` footer, **no** `Co-Authored-By`. Prefer `/commit-msg`.
- **Single PR, one commit per task** (or squash at the end). Push at the end of each task so progress is visible.

### The shared interface contract this ticket creates (siblings depend on it exactly)

- **Stage labels** (string literals): `"link"`, `"cluster"`, `"summarize"`. A `link`-kind run emits both `"link"` and `"cluster"`; a `synthesize`-kind run emits `"summarize"`.
- **`llm/pricing.py`** exports: `Rates` (frozen dataclass), `price(usage, rates, *, batch) -> float`, `HAIKU_4_5`, `SONNET_4_6`, `rates_for(model) -> Rates`, and the multiplier constants. Unknown model ⇒ `KeyError`.
- **`ingest.run_llm_usage`** table: one row per `(run_id, stage)`, UPSERT on `uq_run_llm_usage_run_stage`.
- **`record_llm_usage(session, run_id, *, stage, model, batched, usage)`** computes cost via `pricing.price(usage, pricing.rates_for(model), batch=batched)` and UPSERTs the row. Caller owns commit.
- **`RunLLMUsageOut`** + **`RunOut.llm_usage: list[RunLLMUsageOut]`** on the admin API.

---

## Task 1: Pricing module + measurement-script refactor

Lift the cost math out of `scripts/measure_link_cost.py` into a new `src/upmovies/llm/pricing.py` so production telemetry and the measurement script compute identical dollars from one source of truth. Add the Sonnet rate, a model→rate registry, and `rates_for`. Refactor the script to import from the module with **no behaviour change**.

**Files:**
- Create: `src/upmovies/llm/pricing.py`
- Modify: `scripts/measure_link_cost.py` (lines 35–65: delete the local `_CACHE_*`/`_BATCH_DISCOUNT` constants, `Rates`, `HAIKU_4_5`, and `price`; import them instead; line 30 import already pulls `Usage`)
- Modify: `src/upmovies/llm/__init__.py` (re-export the new public symbols)
- Create: `tests/unit/llm/test_pricing.py`
- Modify: `tests/unit/scripts/test_measure_link_cost.py` (lines 3–9: import `Rates`/`price` from `upmovies.llm.pricing`, keep `format_report`/`measure_*` from the script)

**Interfaces:**
- Consumes: `upmovies.llm.client.Usage` (existing frozen dataclass: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`).
- Produces:
  - `_CACHE_WRITE_MULT: float = 1.25`, `_CACHE_READ_MULT: float = 0.10`, `_BATCH_DISCOUNT: float = 0.50`
  - `@dataclass(frozen=True) class Rates: input_per_mtok: float; output_per_mtok: float`
  - `HAIKU_4_5 = Rates(input_per_mtok=1.00, output_per_mtok=5.00)`
  - `SONNET_4_6 = Rates(input_per_mtok=3.00, output_per_mtok=15.00)`
  - `_RATES: dict[str, Rates] = {"claude-haiku-4-5": HAIKU_4_5, "claude-sonnet-4-6": SONNET_4_6}`
  - `def rates_for(model: str) -> Rates` — returns `_RATES[model]`; raises `KeyError` on unknown model.
  - `def price(usage: Usage, rates: Rates, *, batch: bool) -> float`

- [ ] **Step 1: Create the work branch**

```bash
cd /Users/trb74/projects/upcoming-movies/upcoming-movies-backend
git checkout main && git pull
git checkout -b tom/neu-375-backend-capture-persist-per-stage-llm-token-usage-cost-on
```

- [ ] **Step 2: Confirm the container is up**

```bash
task up
```

Expected: `upmovies-backend` container running (needed for every `task` target below).

- [ ] **Step 3: Write the failing pricing test**

Create `tests/unit/llm/test_pricing.py`:

```python
import pytest

from upmovies.llm.client import Usage
from upmovies.llm.pricing import (
    HAIKU_4_5,
    SONNET_4_6,
    Rates,
    price,
    rates_for,
)


def test_price_full_rates_sequential():
    # 1,000,000 uncached input @ $1 + 1,000,000 output @ $5 = $6.00
    u = Usage(input_tokens=1_000_000, output_tokens=1_000_000)
    assert price(u, HAIKU_4_5, batch=False) == 6.0


def test_price_cache_multipliers():
    # cache write = 1.25x input, cache read = 0.10x input → 1.25 + 0.10 = $1.35
    u = Usage(cache_creation_input_tokens=1_000_000, cache_read_input_tokens=1_000_000)
    assert price(u, HAIKU_4_5, batch=False) == 1.35


def test_price_batch_halves_total():
    u = Usage(input_tokens=1_000_000, output_tokens=1_000_000)
    assert price(u, HAIKU_4_5, batch=True) == 3.0


def test_rates_for_known_models():
    assert rates_for("claude-haiku-4-5") is HAIKU_4_5
    assert rates_for("claude-sonnet-4-6") is SONNET_4_6


def test_rates_for_unknown_model_raises_keyerror():
    with pytest.raises(KeyError):
        rates_for("claude-opus-9-9")


def test_sonnet_is_three_times_haiku_input():
    assert SONNET_4_6.input_per_mtok == 3.0
    assert SONNET_4_6.output_per_mtok == 15.0


def test_rates_is_frozen():
    r = Rates(input_per_mtok=1.0, output_per_mtok=5.0)
    with pytest.raises(Exception):
        r.input_per_mtok = 2.0  # type: ignore[misc]
```

- [ ] **Step 4: Run the pricing test to verify it fails**

Run: `task test -- tests/unit/llm/test_pricing.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'upmovies.llm.pricing'` (collection error before any assertion runs).

- [ ] **Step 5: Create `src/upmovies/llm/pricing.py`**

```python
"""Single source of truth for Claude API cost math. Lifted verbatim from the
`measure_link_cost` script (NEU-297) so the measurement harness and production telemetry
(NEU-375) price identical dollars from the same constants. Adding a new model means adding
its `Rates` to `_RATES` — `rates_for` raises `KeyError` on an unknown model rather than
silently mispricing it."""

from dataclasses import dataclass

from upmovies.llm.client import Usage

# Cache pricing multipliers (relative to base input): 5-min ephemeral write = 1.25x,
# read = 0.10x. Batch path applies a flat 50% discount on the whole total.
_CACHE_WRITE_MULT = 1.25
_CACHE_READ_MULT = 0.10
_BATCH_DISCOUNT = 0.50


@dataclass(frozen=True)
class Rates:
    """Per-million-token USD rates. VERIFY against https://www.anthropic.com/pricing before
    trusting the $ figures — raw token counts are the recorded source of truth."""

    input_per_mtok: float
    output_per_mtok: float


# VERIFY current rates before trusting $ output.
HAIKU_4_5 = Rates(input_per_mtok=1.00, output_per_mtok=5.00)
SONNET_4_6 = Rates(input_per_mtok=3.00, output_per_mtok=15.00)

# model id -> rates. Add a model here when a stage starts using it (else rates_for raises).
_RATES: dict[str, Rates] = {
    "claude-haiku-4-5": HAIKU_4_5,
    "claude-sonnet-4-6": SONNET_4_6,
}


def rates_for(model: str) -> Rates:
    """Look up the per-mtok rates for a model id. Raises KeyError on an unknown model —
    adding a model to the pipeline means adding its Rates to `_RATES`."""
    return _RATES[model]


def price(usage: Usage, rates: Rates, *, batch: bool) -> float:
    """Dollar cost of `usage` at `rates`. Cache writes cost 1.25x base input, cache reads
    0.10x; the batch path applies a flat 50% discount on the whole total."""
    base_in = rates.input_per_mtok / 1_000_000
    out = rates.output_per_mtok / 1_000_000
    cost = (
        usage.input_tokens * base_in
        + usage.cache_creation_input_tokens * base_in * _CACHE_WRITE_MULT
        + usage.cache_read_input_tokens * base_in * _CACHE_READ_MULT
        + usage.output_tokens * out
    )
    return cost * (_BATCH_DISCOUNT if batch else 1.0)
```

- [ ] **Step 6: Run the pricing test to verify it passes**

Run: `task test -- tests/unit/llm/test_pricing.py`
Expected: PASS — all 7 tests green.

- [ ] **Step 7: Re-export the pricing symbols from `src/upmovies/llm/__init__.py`**

Append these lines to `src/upmovies/llm/__init__.py` (keep existing client re-exports):

```python
from upmovies.llm.pricing import HAIKU_4_5 as HAIKU_4_5
from upmovies.llm.pricing import SONNET_4_6 as SONNET_4_6
from upmovies.llm.pricing import Rates as Rates
from upmovies.llm.pricing import price as price
from upmovies.llm.pricing import rates_for as rates_for
```

- [ ] **Step 8: Refactor `scripts/measure_link_cost.py` to import from the module**

In `scripts/measure_link_cost.py`, change the import on line 30 (it currently imports `Usage` from `upmovies.llm.client`) and add the pricing import. The current import block is:

```python
from upmovies.llm.client import AnthropicClient, BatchResult, Usage
```

Add directly below it:

```python
from upmovies.llm.pricing import HAIKU_4_5, Rates, price
```

Then delete lines 35–65 — the local constants, `Rates` dataclass, `HAIKU_4_5`, and `price` function:

```python
# Cache pricing multipliers (relative to base input): 5-min ephemeral write = 1.25x, read = 0.10x.
_CACHE_WRITE_MULT = 1.25
_CACHE_READ_MULT = 0.10
_BATCH_DISCOUNT = 0.50


@dataclass(frozen=True)
class Rates:
    """Per-million-token USD rates. VERIFY against https://www.anthropic.com/pricing before
    trusting the $ figures — raw token counts are the recorded source of truth."""

    input_per_mtok: float
    output_per_mtok: float


# Claude Haiku 4.5 (the link model). VERIFY current rates before trusting $ output.
HAIKU_4_5 = Rates(input_per_mtok=1.00, output_per_mtok=5.00)


def price(usage: Usage, rates: Rates, *, batch: bool) -> float:
    """Dollar cost of `usage` at `rates`. Cache writes cost 1.25x base input, cache reads
    0.10x; the batch path applies a flat 50% discount on the whole total."""
    base_in = rates.input_per_mtok / 1_000_000
    out = rates.output_per_mtok / 1_000_000
    cost = (
        usage.input_tokens * base_in
        + usage.cache_creation_input_tokens * base_in * _CACHE_WRITE_MULT
        + usage.cache_read_input_tokens * base_in * _CACHE_READ_MULT
        + usage.output_tokens * out
    )
    return cost * (_BATCH_DISCOUNT if batch else 1.0)
```

`format_report`, `measure_sequential`, `measure_batched`, `select_corpus`, and the rest stay unchanged — they reference `Rates`/`price`/`HAIKU_4_5` which are now imported names. The `@dataclass` import (`from dataclasses import dataclass, replace`) stays because `replace` is still used at line 207; `dataclass` is no longer used in this module — leave the combined import as-is (ruff will flag an unused `dataclass` only if `replace` were also gone; `replace` keeps the line, but ruff `F401` flags the specific unused name). If `task lint` flags `dataclass` as unused, change the import to `from dataclasses import replace`.

- [ ] **Step 9: Point the script's existing unit test at the module**

In `tests/unit/scripts/test_measure_link_cost.py`, change the import block (lines 3–11). Replace:

```python
from scripts.measure_link_cost import (
    Rates,
    format_report,
    measure_batched,
    measure_sequential,
    price,
)
from upmovies.link.roster import Roster, RosterEntry
from upmovies.llm.client import BatchResult, Usage
```

with:

```python
from scripts.measure_link_cost import (
    format_report,
    measure_batched,
    measure_sequential,
)
from upmovies.link.roster import Roster, RosterEntry
from upmovies.llm.client import BatchResult, Usage
from upmovies.llm.pricing import Rates, price
```

(`Rates`/`price` now come from the module; everything else is unchanged. The three `price`/`format_report` assertions still pass because the math is byte-identical.)

- [ ] **Step 10: Run the script + pricing tests together**

Run: `task test -- tests/unit/scripts/test_measure_link_cost.py tests/unit/llm/test_pricing.py`
Expected: PASS — `test_price_full_rates_sequential`, `test_price_cache_multipliers`, `test_price_batch_halves_total`, `test_format_report_includes_totals_and_decision_fields`, the `measure_*` tests, and all pricing tests green. This proves the script imports and prices identically through the shared module.

- [ ] **Step 11: Lint, typecheck, format**

```bash
task format
task lint
task typecheck
```

Expected: all green. If `task lint` reports `F401 'dataclasses.dataclass' imported but unused` in `scripts/measure_link_cost.py`, apply the fallback from Step 8 (`from dataclasses import replace`) and re-run `task lint`.

- [ ] **Step 12: Commit Task 1**

Generate the message with `/commit-msg`, or:

```bash
task format
git add src/upmovies/llm/pricing.py src/upmovies/llm/__init__.py scripts/measure_link_cost.py tests/unit/llm/test_pricing.py tests/unit/scripts/test_measure_link_cost.py
git commit -m "feat: extract shared LLM pricing module

Lift the cost math (Rates, price, cache/batch multipliers) out of
scripts/measure_link_cost.py into upmovies.llm.pricing as the single source
of truth for production telemetry and the measurement harness. Add the
claude-sonnet-4-6 rate, a model->rate registry, and rates_for(model) (KeyError
on unknown model). Refactor the script to import the shared helper; no
behaviour change.

Refs NEU-375."
git push -u origin tom/neu-375-backend-capture-persist-per-stage-llm-token-usage-cost-on
```

---

## Task 2: `RunLLMUsage` ORM model + Alembic migration

Add the per-stage usage table. One row per `(run_id, stage)`, FK to `ingest.ingest_run`, a stage CHECK constraint, and a unique `(run_id, stage)` constraint for the UPSERT in Task 3.

**Files:**
- Modify: `src/upmovies/ingest/models.py` (add `RunLLMUsage` after `IngestRun`; add imports `Boolean`, `ForeignKey`, `Numeric`, `UniqueConstraint`)
- Create: `migrations/versions/<rev>_add_ingest_run_llm_usage_table.py` (generated by `task makemigration`, then reviewed)
- Create: `tests/integration/ingest/test_run_llm_usage_model.py`

**Interfaces:**
- Consumes: `IngestRun` (FK target `ingest.ingest_run.id`), `upmovies.db.Base`.
- Produces: ORM model `RunLLMUsage` with `__tablename__ = "run_llm_usage"`, schema `"ingest"`. Columns:
  - `id: UUID` — PK, `server_default=text("gen_random_uuid()")`
  - `run_id: UUID` — FK → `ingest.ingest_run.id`, `nullable=False`, indexed (`index=True`)
  - `stage: str` — `Text`, `nullable=False`, CHECK `stage IN ('link','cluster','summarize')` named `ck_run_llm_usage_stage`
  - `model: str` — `Text`, `nullable=False`
  - `batched: bool` — `Boolean`, `nullable=False`
  - `input_tokens / output_tokens / cache_read_input_tokens / cache_creation_input_tokens: int` — `Integer`, `nullable=False`, `server_default=text("0")`
  - `cost_usd: Decimal` — `Numeric(12, 6)`, `nullable=False`
  - `UniqueConstraint("run_id", "stage", name="uq_run_llm_usage_run_stage")`

- [ ] **Step 1: Write the failing model integration test**

Create `tests/integration/ingest/test_run_llm_usage_model.py`:

```python
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from upmovies.ingest.models import RunLLMUsage
from upmovies.ingest.runs import create_run


async def test_insert_and_read_back_a_usage_row(session):
    run_id = await create_run(session, kind="link")
    row = RunLLMUsage(
        run_id=run_id,
        stage="link",
        model="claude-haiku-4-5",
        batched=True,
        input_tokens=100,
        output_tokens=10,
        cache_read_input_tokens=900,
        cache_creation_input_tokens=50,
        cost_usd=Decimal("0.001234"),
    )
    session.add(row)
    await session.commit()

    got = (
        await session.execute(select(RunLLMUsage).where(RunLLMUsage.run_id == run_id))
    ).scalar_one()
    assert got.stage == "link"
    assert got.model == "claude-haiku-4-5"
    assert got.batched is True
    assert got.input_tokens == 100
    assert got.cache_read_input_tokens == 900
    assert got.cost_usd == Decimal("0.001234")


async def test_token_columns_default_to_zero(session):
    run_id = await create_run(session, kind="link")
    row = RunLLMUsage(
        run_id=run_id,
        stage="cluster",
        model="claude-sonnet-4-6",
        batched=False,
        cost_usd=Decimal("0"),
    )
    session.add(row)
    await session.commit()
    got = (
        await session.execute(select(RunLLMUsage).where(RunLLMUsage.run_id == run_id))
    ).scalar_one()
    assert got.input_tokens == 0
    assert got.output_tokens == 0
    assert got.cache_read_input_tokens == 0
    assert got.cache_creation_input_tokens == 0


async def test_stage_check_constraint_rejects_bad_stage(session):
    run_id = await create_run(session, kind="link")
    session.add(
        RunLLMUsage(
            run_id=run_id,
            stage="bogus",
            model="m",
            batched=False,
            cost_usd=Decimal("0"),
        )
    )
    with pytest.raises(IntegrityError):
        await session.commit()


async def test_unique_run_stage_rejects_duplicate(session):
    run_id = await create_run(session, kind="link")
    session.add(
        RunLLMUsage(run_id=run_id, stage="link", model="m", batched=False, cost_usd=Decimal("0"))
    )
    await session.commit()
    session.add(
        RunLLMUsage(run_id=run_id, stage="link", model="m", batched=False, cost_usd=Decimal("0"))
    )
    with pytest.raises(IntegrityError):
        await session.commit()
```

- [ ] **Step 2: Run the model test to verify it fails**

Run: `task test -- tests/integration/ingest/test_run_llm_usage_model.py`
Expected: FAIL — `ImportError: cannot import name 'RunLLMUsage' from 'upmovies.ingest.models'` (collection error).

- [ ] **Step 3: Add the `RunLLMUsage` model**

In `src/upmovies/ingest/models.py`, change the imports on line 4 from:

```python
from sqlalchemy import CheckConstraint, DateTime, Integer, Text, text
```

to:

```python
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    Text,
    UniqueConstraint,
    text,
)
```

Also import `Decimal` at the top (the `cost_usd` Mapped type). Change the first line from `from datetime import datetime` to keep it and add below the `from uuid import UUID` line:

```python
from decimal import Decimal
```

Append this model after the `IngestRun` class (end of file):

```python
class RunLLMUsage(Base):
    """Per-stage LLM token usage + estimated dollar cost for one ingest run. A `link`-kind
    run writes a `link` row and a `cluster` row; a `synthesize`-kind run writes a `summarize`
    row. One row per (run, stage) — `record_llm_usage` UPSERTs on the unique constraint."""

    __tablename__ = "run_llm_usage"
    __table_args__ = (
        CheckConstraint(
            "stage IN ('link', 'cluster', 'summarize')", name="ck_run_llm_usage_stage"
        ),
        UniqueConstraint("run_id", "stage", name="uq_run_llm_usage_run_stage"),
        {"schema": "ingest"},
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    run_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("ingest.ingest_run.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    stage: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str] = mapped_column(Text, nullable=False)
    batched: Mapped[bool] = mapped_column(Boolean, nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    cache_read_input_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    cache_creation_input_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), nullable=False)
```

- [ ] **Step 4: Run the model test to verify it passes**

Run: `task test -- tests/integration/ingest/test_run_llm_usage_model.py`
Expected: PASS — all 4 tests green (the test DB builds the table via `create_all`, so the migration is not needed for tests).

- [ ] **Step 5: Generate the Alembic migration**

```bash
task makemigration -- "add ingest.run_llm_usage table"
```

Expected: a new file under `migrations/versions/` whose `down_revision` points at the current head (`f54c48912dbc` at time of writing — confirm the autogenerate picked it up).

- [ ] **Step 6: Review the generated migration by hand**

Open the new `migrations/versions/<rev>_add_ingest_run_llm_usage_table.py`. Confirm `upgrade()` matches this shape (autogenerate may order columns differently — that is fine; verify the constraints, schema, FK, and index are present):

```python
def upgrade() -> None:
    op.create_table(
        'run_llm_usage',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('run_id', sa.UUID(), nullable=False),
        sa.Column('stage', sa.Text(), nullable=False),
        sa.Column('model', sa.Text(), nullable=False),
        sa.Column('batched', sa.Boolean(), nullable=False),
        sa.Column('input_tokens', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('output_tokens', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('cache_read_input_tokens', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('cache_creation_input_tokens', sa.Integer(), server_default=sa.text('0'), nullable=False),
        sa.Column('cost_usd', sa.Numeric(precision=12, scale=6), nullable=False),
        sa.CheckConstraint("stage IN ('link', 'cluster', 'summarize')", name='ck_run_llm_usage_stage'),
        sa.ForeignKeyConstraint(['run_id'], ['ingest.ingest_run.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('run_id', 'stage', name='uq_run_llm_usage_run_stage'),
        schema='ingest',
    )
    op.create_index('ix_run_llm_usage_run_id', 'run_llm_usage', ['run_id'], unique=False, schema='ingest')
```

and `downgrade()`:

```python
def downgrade() -> None:
    op.drop_index('ix_run_llm_usage_run_id', table_name='run_llm_usage', schema='ingest')
    op.drop_table('run_llm_usage', schema='ingest')
```

If autogenerate omitted the index name or used a different one, leave whatever it generated as long as `run_id` is indexed. Do **not** hand-edit the revision IDs.

- [ ] **Step 7: Apply the migration**

```bash
task migrate
```

Expected: `Running upgrade <prev> -> <rev>, add ingest.run_llm_usage table` with no error. (This proves the migration applies cleanly against the real dev DB, independent of the `create_all` path tests use.)

- [ ] **Step 8: Lint, typecheck, format**

```bash
task format
task lint
task typecheck
```

Expected: all green.

- [ ] **Step 9: Commit Task 2**

```bash
task format
git add src/upmovies/ingest/models.py migrations/versions/ tests/integration/ingest/test_run_llm_usage_model.py
git commit -m "feat: add ingest.run_llm_usage table

One row per (run, stage) holding per-stage LLM token counts (input/output/
cache_read/cache_creation), the model, the batched flag, and an estimated
cost_usd. CHECK on stage in (link, cluster, summarize); unique (run_id, stage)
for UPSERT; FK to ingest.ingest_run. Includes the Alembic migration.

Refs NEU-375."
git push
```

---

## Task 3: `record_llm_usage` recording helper

Add the UPSERT helper beside `create_run`/`record_progress`/`finalize_run`. It prices the usage via the Task 1 module and writes one `(run_id, stage)` row, overwriting on conflict so a re-run of a stage refreshes rather than duplicates.

**Files:**
- Modify: `src/upmovies/ingest/runs.py` (add `record_llm_usage`; add imports)
- Create: `tests/integration/ingest/test_record_llm_usage.py`

**Interfaces:**
- Consumes: `RunLLMUsage` (Task 2), `upmovies.llm.client.Usage`, `upmovies.llm.pricing` (`price`, `rates_for`), `sqlalchemy.dialects.postgresql.insert`.
- Produces: `async def record_llm_usage(session: AsyncSession, run_id: UUID, *, stage: str, model: str, batched: bool, usage: Usage) -> None` — computes `cost = price(usage, rates_for(model), batch=batched)`, UPSERTs the `(run_id, stage)` row on `uq_run_llm_usage_run_stage` (sets every token column + `model`, `batched`, `cost_usd`). Caller owns commit.

- [ ] **Step 1: Write the failing helper test**

Create `tests/integration/ingest/test_record_llm_usage.py`:

```python
from decimal import Decimal

from sqlalchemy import select

from upmovies.ingest import runs
from upmovies.ingest.models import RunLLMUsage
from upmovies.llm.client import Usage
from upmovies.llm.pricing import HAIKU_4_5, price


async def test_record_llm_usage_inserts_priced_row(session):
    run_id = await runs.create_run(session, kind="link")
    usage = Usage(
        input_tokens=1_000_000,
        output_tokens=1_000_000,
        cache_read_input_tokens=0,
        cache_creation_input_tokens=0,
    )
    await runs.record_llm_usage(
        session, run_id, stage="link", model="claude-haiku-4-5", batched=False, usage=usage
    )
    await session.commit()

    row = (
        await session.execute(
            select(RunLLMUsage).where(RunLLMUsage.run_id == run_id),
            execution_options={"populate_existing": True},
        )
    ).scalar_one()
    assert row.stage == "link"
    assert row.model == "claude-haiku-4-5"
    assert row.batched is False
    assert row.input_tokens == 1_000_000
    assert row.output_tokens == 1_000_000
    # full-rate price: $1/Mtok in + $5/Mtok out = $6.000000
    assert row.cost_usd == Decimal("6.000000")
    assert float(row.cost_usd) == price(usage, HAIKU_4_5, batch=False)


async def test_record_llm_usage_applies_batch_discount(session):
    run_id = await runs.create_run(session, kind="link")
    usage = Usage(input_tokens=1_000_000, output_tokens=1_000_000)
    await runs.record_llm_usage(
        session, run_id, stage="link", model="claude-haiku-4-5", batched=True, usage=usage
    )
    await session.commit()
    row = (
        await session.execute(select(RunLLMUsage).where(RunLLMUsage.run_id == run_id))
    ).scalar_one()
    # batch halves the $6.00 → $3.00
    assert row.cost_usd == Decimal("3.000000")


async def test_record_llm_usage_upserts_on_run_stage(session):
    run_id = await runs.create_run(session, kind="link")
    await runs.record_llm_usage(
        session,
        run_id,
        stage="link",
        model="claude-haiku-4-5",
        batched=False,
        usage=Usage(input_tokens=10),
    )
    await session.commit()
    # second call for the same (run, stage) overwrites, not duplicates
    await runs.record_llm_usage(
        session,
        run_id,
        stage="link",
        model="claude-haiku-4-5",
        batched=False,
        usage=Usage(input_tokens=99),
    )
    await session.commit()

    rows = (
        (
            await session.execute(
                select(RunLLMUsage).where(RunLLMUsage.run_id == run_id),
                execution_options={"populate_existing": True},
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].input_tokens == 99


async def test_record_llm_usage_two_stages_two_rows(session):
    run_id = await runs.create_run(session, kind="link")
    await runs.record_llm_usage(
        session, run_id, stage="link", model="claude-haiku-4-5", batched=False, usage=Usage()
    )
    await runs.record_llm_usage(
        session, run_id, stage="cluster", model="claude-sonnet-4-6", batched=False, usage=Usage()
    )
    await session.commit()
    rows = (
        (await session.execute(select(RunLLMUsage).where(RunLLMUsage.run_id == run_id)))
        .scalars()
        .all()
    )
    assert {r.stage for r in rows} == {"link", "cluster"}
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run: `task test -- tests/integration/ingest/test_record_llm_usage.py`
Expected: FAIL — `AttributeError: module 'upmovies.ingest.runs' has no attribute 'record_llm_usage'`.

- [ ] **Step 3: Implement `record_llm_usage`**

In `src/upmovies/ingest/runs.py`, change the imports. The current block is:

```python
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from upmovies.ingest.models import IngestRun
```

Replace it with:

```python
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from upmovies.ingest.models import IngestRun, RunLLMUsage
from upmovies.llm.client import Usage
from upmovies.llm.pricing import price, rates_for
```

Append this function at the end of the module:

```python
async def record_llm_usage(
    session: AsyncSession,
    run_id: UUID,
    *,
    stage: str,
    model: str,
    batched: bool,
    usage: Usage,
) -> None:
    """UPSERT the per-stage LLM usage + estimated dollar cost for a run. Prices `usage` via
    the shared pricing module (`rates_for(model)` raises KeyError on an unknown model) and
    writes one row per (run_id, stage), overwriting on the uq_run_llm_usage_run_stage
    conflict so a stage re-run refreshes rather than duplicates. Caller owns the commit."""
    cost = Decimal(str(price(usage, rates_for(model), batch=batched)))
    stmt = pg_insert(RunLLMUsage).values(
        run_id=run_id,
        stage=stage,
        model=model,
        batched=batched,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        cache_read_input_tokens=usage.cache_read_input_tokens,
        cache_creation_input_tokens=usage.cache_creation_input_tokens,
        cost_usd=cost,
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_run_llm_usage_run_stage",
        set_={
            "model": model,
            "batched": batched,
            "input_tokens": usage.input_tokens,
            "output_tokens": usage.output_tokens,
            "cache_read_input_tokens": usage.cache_read_input_tokens,
            "cache_creation_input_tokens": usage.cache_creation_input_tokens,
            "cost_usd": cost,
        },
    )
    await session.execute(stmt)
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run: `task test -- tests/integration/ingest/test_record_llm_usage.py`
Expected: PASS — all 4 tests green (insert+price, batch discount, UPSERT idempotency, two-stage rows).

- [ ] **Step 5: Lint, typecheck, format**

```bash
task format
task lint
task typecheck
```

Expected: all green.

- [ ] **Step 6: Commit Task 3**

```bash
task format
git add src/upmovies/ingest/runs.py tests/integration/ingest/test_record_llm_usage.py
git commit -m "feat: add record_llm_usage UPSERT helper

Price a stage's aggregated Usage via the shared pricing module and UPSERT one
ingest.run_llm_usage row per (run_id, stage), overwriting on conflict so a
stage re-run refreshes rather than duplicates. Caller owns the commit.

Refs NEU-375."
git push
```

---

## Task 4: Thread usage through the link + cluster pipeline and record per-stage rows

Stop discarding usage on both link and cluster. `link_story_batch` and `cluster_film_events` switch their internal `complete()` to `complete_with_usage()` and return `(Result, Usage)`. The batched stage helpers aggregate `BatchResult.usage`. `run_link_ingest` accumulates a `link` stage `Usage` and a `cluster` stage `Usage`, then calls `record_llm_usage` for each at its stage's end (model = `settings.link_model` / `settings.cluster_model`; `batched` = the path taken).

**Files:**
- Modify: `src/upmovies/link/linker.py` (`Completer` protocol → `complete_with_usage`; `link_story_batch` → `(BatchLinkResult, Usage)`)
- Modify: `src/upmovies/link/cluster.py` (`cluster_film_events` → `(ClusterResult, Usage)`; uses linker `Completer`)
- Modify: `src/upmovies/link/pipeline.py` (stage helpers return usage; `run_link_ingest` records `link` + `cluster`; add `record_llm_usage` import + `Usage` import)
- Modify: `tests/unit/link/test_linker.py` (`FakeClient` → `complete_with_usage`; `_run` destructures the tuple)
- Modify: `tests/integration/link/test_cluster.py` (`FakeClient` → `complete_with_usage`; the 5 `cluster_film_events` call sites destructure the tuple)
- Modify: `tests/integration/link/test_pipeline.py` (`FakeClient.complete` → also expose `complete_with_usage`; `BatchResult`s set `usage=`)
- Create: `tests/integration/link/test_pipeline_usage.py` (new: asserts `link` + `cluster` rows are recorded)
- Modify: `scripts/validate_linking.py` & `scripts/diagnose_linking.py` — call sites ignore the return value already, but the linker `Completer` protocol now needs `complete_with_usage`; they pass `AnthropicClient` (which has it), so no change to those scripts is required. **Verify** no edit is needed by re-reading those two call sites; do not touch them.

**Interfaces:**
- Consumes: `record_llm_usage` (Task 3), `Usage`.
- Produces:
  - linker `Completer` Protocol: `async def complete_with_usage(self, *, model, system, messages, max_tokens=...) -> tuple[str, Usage]`
  - `async def link_story_batch(...) -> tuple[BatchLinkResult, Usage]`
  - `async def cluster_film_events(...) -> tuple[ClusterResult, Usage]`
  - `_link_stage_sequential` / `_link_stage_batched` → `tuple[int, int, Usage]` (linked, rejected, aggregated link usage)
  - `_cluster_stage_sequential` / `_cluster_stage_batched` → `tuple[int, int, int, Usage]` (events_created, stories_clustered, stories_rejected, aggregated cluster usage)
  - `run_link_ingest` unchanged signature, returns `LinkIngestResult`, side-effect: writes a `link` row and a `cluster` row.

- [ ] **Step 1: Write the failing link-pipeline usage test**

Create `tests/integration/link/test_pipeline_usage.py`:

```python
import json
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from upmovies.catalog.models import Film
from upmovies.ingest.models import RunLLMUsage
from upmovies.ingest.runs import create_run
from upmovies.llm.client import BatchResult, Usage
from upmovies.link.pipeline import run_link_ingest
from upmovies.news.models import Story


class UsageFakeClient:
    """Returns a fixed Usage on both surfaces, routing decisions on the same prompt sniff
    the production FakeClient uses (entity-linking classifier vs cluster)."""

    def __init__(self, usage: Usage):
        self._usage = usage

    async def complete_with_usage(self, *, model, system, messages, max_tokens=4096):
        return self._decide(system, messages), self._usage

    async def complete_batch(self, requests, *, poll_interval=15.0, timeout=3600.0) -> dict:
        return {
            r.custom_id: BatchResult(
                custom_id=r.custom_id,
                ok=True,
                text=self._decide(r.system, r.messages),
                usage=self._usage,
            )
            for r in requests
        }

    def _decide(self, system, messages) -> str:
        if "entity-linking classifier" in system[0]["text"]:
            stories = json.loads(messages[0]["content"])
            return json.dumps(
                [{"id": s["id"], "film": 1, "confidence": 0.95, "reason": "about"} for s in stories]
            )
        new_ns = [s["n"] for s in json.loads(messages[0]["content"])["new_stories"]]
        return json.dumps(
            {"events": [{"existing": None, "type": "trailer", "confidence": "confirmed", "stories": new_ns}]}
        )


async def _story(session, url):
    s = Story(
        source="X",
        url=url,
        title="Runner news",
        published_at=datetime.now(UTC) - timedelta(days=1),
        link_status="pending",
        raw={"summary": ""},
    )
    session.add(s)
    await session.flush()
    return s


async def test_run_link_ingest_records_link_and_cluster_usage(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    await _story(session, "https://e/1")
    await session.commit()
    run_id = await create_run(session, kind="link")
    await session.commit()

    usage = Usage(input_tokens=100, output_tokens=10, cache_read_input_tokens=900)
    await run_link_ingest(
        session_factory=lambda: session,
        client=UsageFakeClient(usage),
        run_id=run_id,
        model="claude-haiku-4-5",
        cluster_model="claude-sonnet-4-6",
        recency_days=45,
        batch_size=10,
        floor=0.7,
        use_batches=False,
    )

    rows = {
        r.stage: r
        for r in (
            await session.execute(
                select(RunLLMUsage).where(RunLLMUsage.run_id == run_id),
                execution_options={"populate_existing": True},
            )
        )
        .scalars()
        .all()
    }
    assert set(rows) == {"link", "cluster"}
    assert rows["link"].model == "claude-haiku-4-5"
    assert rows["link"].batched is False
    assert rows["link"].input_tokens == 100
    assert rows["link"].output_tokens == 10
    assert rows["link"].cache_read_input_tokens == 900
    assert rows["cluster"].model == "claude-sonnet-4-6"
    assert rows["cluster"].input_tokens == 100


async def test_run_link_ingest_records_batched_flag(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    await _story(session, "https://e/1")
    await session.commit()
    run_id = await create_run(session, kind="link")
    await session.commit()

    await run_link_ingest(
        session_factory=lambda: session,
        client=UsageFakeClient(Usage(input_tokens=5)),
        run_id=run_id,
        model="claude-haiku-4-5",
        cluster_model="claude-sonnet-4-6",
        recency_days=45,
        batch_size=10,
        floor=0.7,
        use_batches=True,
    )

    rows = {
        r.stage: r
        for r in (
            await session.execute(select(RunLLMUsage).where(RunLLMUsage.run_id == run_id))
        )
        .scalars()
        .all()
    }
    assert rows["link"].batched is True
    assert rows["cluster"].batched is True
```

- [ ] **Step 2: Run the new usage test to verify it fails**

Run: `task test -- tests/integration/link/test_pipeline_usage.py`
Expected: FAIL — the run completes but no `run_llm_usage` rows exist, so `assert set(rows) == {"link", "cluster"}` fails with `assert set() == {'link', 'cluster'}`. (`UsageFakeClient` exposes `complete_with_usage`, which `link_story_batch` does not yet call, so the sequential link path will raise `AttributeError: 'UsageFakeClient' object has no attribute 'complete'` — either way it fails until the implementation lands. The assertion failure is the target once Steps 3–7 are in.)

- [ ] **Step 3: Switch the linker `Completer` protocol + `link_story_batch` to usage**

In `src/upmovies/link/linker.py`:

Change the import on line 13 from:

```python
from upmovies.llm.client import BatchRequest, BatchResult, cached_system_block
```

to:

```python
from upmovies.llm.client import BatchRequest, BatchResult, Usage, cached_system_block
```

Replace the `Completer` Protocol (lines 64–72):

```python
class Completer(Protocol):
    async def complete(
        self,
        *,
        model: str,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        max_tokens: int = ...,
    ) -> str: ...
```

with:

```python
class Completer(Protocol):
    async def complete_with_usage(
        self,
        *,
        model: str,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        max_tokens: int = ...,
    ) -> tuple[str, "Usage"]: ...
```

Replace `link_story_batch` (lines 194–208):

```python
async def link_story_batch(
    *,
    client: Completer,
    model: str,
    roster: Roster,
    stories: Sequence[Story],
    floor: float,
) -> BatchLinkResult:
    if not stories:
        return BatchLinkResult(0, 0)
    system, messages = build_link_request(roster, stories)
    raw = await client.complete(
        model=model, system=system, messages=messages, max_tokens=_MAX_TOKENS
    )
    return apply_link_decisions(raw=raw, stories=stories, roster=roster, floor=floor)
```

with:

```python
async def link_story_batch(
    *,
    client: Completer,
    model: str,
    roster: Roster,
    stories: Sequence[Story],
    floor: float,
) -> tuple[BatchLinkResult, Usage]:
    if not stories:
        return BatchLinkResult(0, 0), Usage()
    system, messages = build_link_request(roster, stories)
    raw, usage = await client.complete_with_usage(
        model=model, system=system, messages=messages, max_tokens=_MAX_TOKENS
    )
    return apply_link_decisions(raw=raw, stories=stories, roster=roster, floor=floor), usage
```

- [ ] **Step 4: Switch `cluster_film_events` to usage**

In `src/upmovies/link/cluster.py`:

Change the import on line 18 from:

```python
from upmovies.llm.client import BatchRequest, cached_system_block
```

to:

```python
from upmovies.llm.client import BatchRequest, Usage, cached_system_block
```

Replace `cluster_film_events` (lines 310–329):

```python
async def cluster_film_events(
    session: AsyncSession,
    *,
    client: Completer,
    model: str,
    film_id: UUID,
    attach_limit: int,
    max_tokens: int = _DEFAULT_MAX_TOKENS,
) -> ClusterResult:
    built = await build_cluster_request(session, film_id=film_id, attach_limit=attach_limit)
    if built is None:
        return ClusterResult(0, 0)
    system, messages, plan = built
    raw = await client.complete(
        model=model,
        system=system,
        messages=messages,
        max_tokens=max_tokens,
    )
    return await apply_cluster_decisions(session, plan=plan, raw=raw)
```

with:

```python
async def cluster_film_events(
    session: AsyncSession,
    *,
    client: Completer,
    model: str,
    film_id: UUID,
    attach_limit: int,
    max_tokens: int = _DEFAULT_MAX_TOKENS,
) -> tuple[ClusterResult, Usage]:
    built = await build_cluster_request(session, film_id=film_id, attach_limit=attach_limit)
    if built is None:
        return ClusterResult(0, 0), Usage()
    system, messages, plan = built
    raw, usage = await client.complete_with_usage(
        model=model,
        system=system,
        messages=messages,
        max_tokens=max_tokens,
    )
    return await apply_cluster_decisions(session, plan=plan, raw=raw), usage
```

- [ ] **Step 5: Aggregate usage in the four stage helpers**

In `src/upmovies/link/pipeline.py`:

Change the imports. Current lines 16 + 31–33:

```python
from upmovies.ingest.runs import finalize_run, record_progress
```
```python
from upmovies.link.roster import Roster, build_roster
from upmovies.llm.client import BatchRequest
from upmovies.news.models import EventStory, Story
```

Replace with:

```python
from upmovies.ingest.runs import finalize_run, record_llm_usage, record_progress
```
```python
from upmovies.link.roster import Roster, build_roster
from upmovies.llm.client import BatchRequest, Usage
from upmovies.news.models import EventStory, Story
```

**`_link_stage_sequential`** — change the return type to `tuple[int, int, Usage]`, accumulate usage:

```python
async def _link_stage_sequential(
    *,
    session_factory: SessionFactory,
    client: Completer,
    run_id: UUID,
    model: str,
    roster: Roster,
    pending_ids: Sequence[UUID],
    batch_size: int,
    floor: float,
) -> tuple[int, int, Usage]:
    linked = rejected = 0
    total_usage = Usage()
    for batch_ids in _chunks(pending_ids, batch_size):
        try:
            async with _owned_session(session_factory) as s:
                stories = (
                    (await s.execute(select(Story).where(Story.id.in_(batch_ids)))).scalars().all()
                )
                batch, usage = await link_story_batch(
                    client=client, model=model, roster=roster, stories=list(stories), floor=floor
                )
                await record_progress(s, run_id, processed_delta=batch.linked + batch.rejected)
                await s.commit()
            linked += batch.linked
            rejected += batch.rejected
            total_usage += usage
        except Exception:
            log.exception("link batch of %d stories failed", len(batch_ids))
            async with _owned_session(session_factory) as s:
                await record_progress(s, run_id, failed_delta=len(batch_ids))
                await s.commit()
    return linked, rejected, total_usage
```

**`_link_stage_batched`** — change to `tuple[int, int, Usage]`. The two early `return 0, 0` become `return 0, 0, Usage()`. Aggregate `result.usage` from each ok chunk. The body becomes:

```python
async def _link_stage_batched(
    *,
    session_factory: SessionFactory,
    client: BatchCompleter,
    run_id: UUID,
    model: str,
    roster: Roster,
    pending_ids: Sequence[UUID],
    batch_size: int,
    floor: float,
) -> tuple[int, int, Usage]:
    chunks = _chunks(pending_ids, batch_size)

    requests = []
    async with _owned_session(session_factory) as s:
        for i, batch_ids in enumerate(chunks):
            stories = (
                (await s.execute(select(Story).where(Story.id.in_(batch_ids)))).scalars().all()
            )
            requests.append(
                build_batch_request(
                    custom_id=str(i), model=model, roster=roster, stories=list(stories)
                )
            )

    if not requests:
        return 0, 0, Usage()

    try:
        results = await client.complete_batch(requests)
    except Exception:
        log.exception("link batch submit of %d stories failed", len(pending_ids))
        async with _owned_session(session_factory) as s:
            await record_progress(s, run_id, failed_delta=len(pending_ids))
            await s.commit()
        return 0, 0, Usage()

    linked = rejected = 0
    total_usage = Usage()
    for i, batch_ids in enumerate(chunks):
        result = results.get(str(i))
        try:
            if result is None or not result.ok:
                detail = result.error_type if result else "missing"
                raise RuntimeError(f"batch chunk {i} unavailable: {detail}")
            async with _owned_session(session_factory) as s:
                stories = (
                    (await s.execute(select(Story).where(Story.id.in_(batch_ids)))).scalars().all()
                )
                applied = apply_link_decisions(
                    raw=result.text, stories=list(stories), roster=roster, floor=floor
                )
                await record_progress(s, run_id, processed_delta=applied.linked + applied.rejected)
                await s.commit()
            linked += applied.linked
            rejected += applied.rejected
            if result.usage is not None:
                total_usage += result.usage
        except Exception:
            log.exception("link batch chunk %d of %d stories failed", i, len(batch_ids))
            async with _owned_session(session_factory) as s:
                await record_progress(s, run_id, failed_delta=len(batch_ids))
                await s.commit()

    return linked, rejected, total_usage
```

**`_cluster_stage_sequential`** — change to `tuple[int, int, int, Usage]`, destructure `cluster_film_events`:

```python
async def _cluster_stage_sequential(
    *,
    session_factory: SessionFactory,
    client: Completer,
    run_id: UUID,
    model: str,
    film_ids: Sequence[UUID],
    attach_limit: int,
    cluster_max_tokens: int,
) -> tuple[int, int, int, Usage]:
    events_created = stories_clustered = stories_rejected = 0
    total_usage = Usage()
    for film_id in film_ids:
        try:
            async with _owned_session(session_factory) as s:
                cluster, usage = await cluster_film_events(
                    s,
                    client=client,
                    model=model,
                    film_id=film_id,
                    attach_limit=attach_limit,
                    max_tokens=cluster_max_tokens,
                )
                await s.commit()
            events_created += cluster.events_created
            stories_clustered += cluster.stories_clustered
            stories_rejected += cluster.stories_rejected
            total_usage += usage
        except Exception:
            log.exception("clustering failed for film %s", film_id)
            async with _owned_session(session_factory) as s:
                await record_progress(s, run_id, failed_delta=1)
                await s.commit()
    return events_created, stories_clustered, stories_rejected, total_usage
```

**`_cluster_stage_batched`** — change to `tuple[int, int, int, Usage]`. The two `return 0, 0, 0` become `return 0, 0, 0, Usage()`. Aggregate `result.usage`. The result loop becomes:

```python
    events_created = stories_clustered = stories_rejected = 0
    total_usage = Usage()
    for custom_id, plan in plans.items():
        result = results.get(custom_id)
        try:
            if result is None or not result.ok:
                detail = result.error_type if result else "missing"
                raise RuntimeError(f"cluster film {custom_id} unavailable: {detail}")
            async with _owned_session(session_factory) as s:
                applied = await apply_cluster_decisions(s, plan=plan, raw=result.text)
                await s.commit()
            events_created += applied.events_created
            stories_clustered += applied.stories_clustered
            stories_rejected += applied.stories_rejected
            if result.usage is not None:
                total_usage += result.usage
        except Exception:
            log.exception("clustering failed for film %s", custom_id)
            async with _owned_session(session_factory) as s:
                await record_progress(s, run_id, failed_delta=1)
                await s.commit()

    return events_created, stories_clustered, stories_rejected, total_usage
```

(And update the two pre-loop early returns: `if not requests: return 0, 0, 0, Usage()` and the submit-failure `return 0, 0, 0, Usage()`.)

- [ ] **Step 6: Record `link` + `cluster` rows in `run_link_ingest`**

In `src/upmovies/link/pipeline.py`, `run_link_ingest`: destructure the new stage returns and record usage. Replace the link-stage call (lines 283–293):

```python
    stage = _link_stage_batched if use_batches else _link_stage_sequential
    linked, rejected = await stage(
        session_factory=session_factory,
        client=client,
        run_id=run_id,
        model=model,
        roster=roster,
        pending_ids=pending_ids,
        batch_size=batch_size,
        floor=floor,
    )
```

with:

```python
    stage = _link_stage_batched if use_batches else _link_stage_sequential
    linked, rejected, link_usage = await stage(
        session_factory=session_factory,
        client=client,
        run_id=run_id,
        model=model,
        roster=roster,
        pending_ids=pending_ids,
        batch_size=batch_size,
        floor=floor,
    )
    async with _owned_session(session_factory) as s:
        await record_llm_usage(
            s, run_id, stage="link", model=model, batched=use_batches, usage=link_usage
        )
        await s.commit()
```

Replace the cluster-stage call (lines 316–325):

```python
    cluster_stage = _cluster_stage_batched if use_batches else _cluster_stage_sequential
    events_created, stories_clustered, stories_rejected = await cluster_stage(
        session_factory=session_factory,
        client=client,
        run_id=run_id,
        model=cluster_model,
        film_ids=film_ids,
        attach_limit=attach_limit,
        cluster_max_tokens=cluster_max_tokens,
    )
```

with:

```python
    cluster_stage = _cluster_stage_batched if use_batches else _cluster_stage_sequential
    events_created, stories_clustered, stories_rejected, cluster_usage = await cluster_stage(
        session_factory=session_factory,
        client=client,
        run_id=run_id,
        model=cluster_model,
        film_ids=film_ids,
        attach_limit=attach_limit,
        cluster_max_tokens=cluster_max_tokens,
    )
    async with _owned_session(session_factory) as s:
        await record_llm_usage(
            s, run_id, stage="cluster", model=cluster_model, batched=use_batches, usage=cluster_usage
        )
        await s.commit()
```

- [ ] **Step 7: Run the new usage test to verify it passes**

Run: `task test -- tests/integration/link/test_pipeline_usage.py`
Expected: PASS — both tests green: `link` + `cluster` rows recorded with the right model, tokens, and `batched` flag.

- [ ] **Step 8: Update the linker unit-test fake to `complete_with_usage`**

In `tests/unit/link/test_linker.py`, the `FakeClient` (lines 14–21) only has `complete`. Replace it:

```python
class FakeClient:
    def __init__(self, response: str):
        self._response = response
        self.calls: list[dict] = []

    async def complete_with_usage(self, *, model, system, messages, max_tokens=4096):
        from upmovies.llm.client import Usage

        self.calls.append({"model": model, "system": system, "messages": messages})
        return self._response, Usage()
```

Then update `_run` (lines 37–44) to destructure the tuple `link_story_batch` now returns:

```python
async def _run(response, *, floor=0.7):
    film_id = uuid4()
    story = _story()
    client = FakeClient(response(str(story.id)))
    result, _usage = await link_story_batch(
        client=client, model="m", roster=_roster(film_id), stories=[story], floor=floor
    )
    return story, film_id, client, result
```

(`build_link_request` / `apply_link_decisions` / `build_batch_request` tests are unaffected — they don't call the client.)

- [ ] **Step 9: Run the linker unit tests to verify they pass**

Run: `task test -- tests/unit/link/test_linker.py`
Expected: PASS — all linker tests green (the `_run`-based tests now destructure `(result, usage)`; the rest are unchanged).

- [ ] **Step 10: Update the cluster integration-test fake + call sites**

In `tests/integration/link/test_cluster.py`, the `FakeClient` (lines 19–24) only has `complete`. Replace it:

```python
class FakeClient:
    def __init__(self, response: dict):
        self._response = response
        self.calls: list[dict] = []

    async def complete_with_usage(self, *, model, system, messages, max_tokens=4096):
        from upmovies.llm.client import Usage

        self.calls.append({"system": system, "messages": messages})
        return json.dumps(self._response), Usage()
```

Then update each `cluster_film_events` call to destructure the tuple. There are 5 call sites (lines ~63, 93, 120, 706 plus any added). Each currently reads:

```python
    result = await cluster_film_events(
        session, client=client, model="m", film_id=film.id, attach_limit=45
    )
```

Change `result = await cluster_film_events(` to `result, _usage = await cluster_film_events(` at every `cluster_film_events` call site. (The `test_noop_when_nothing_unclustered` assertion `result == result.__class__(0, 0)` still holds — `cluster_film_events` returns `(ClusterResult(0, 0), Usage())`, and `result` is the unpacked `ClusterResult(0, 0)`.)

- [ ] **Step 11: Run the cluster integration tests to verify they pass**

Run: `task test -- tests/integration/link/test_cluster.py`
Expected: PASS — all cluster tests green (the `apply_cluster_decisions` / `build_cluster_request` tests never touched the client; the `cluster_film_events` tests now destructure the tuple).

- [ ] **Step 12: Update the link pipeline integration-test fakes to carry usage**

In `tests/integration/link/test_pipeline.py`, the production-shaped `FakeClient` (lines 15–59) has `complete` (sequential) and `complete_batch` without `usage`. The sequential link + cluster paths now call `complete_with_usage`. Add `complete_with_usage`, keep `complete` for any remaining sequential cluster usage parity, and set `usage=` on the `BatchResult`s.

Change the import line 11 from:

```python
from upmovies.llm.client import BatchResult
```

to:

```python
from upmovies.llm.client import BatchResult, Usage
```

Replace the `complete` method (lines 24–26) with a `complete_with_usage` method, keeping `complete` too (other tests below still reference `complete_calls`):

```python
    async def complete(self, *, model, system, messages, max_tokens=4096) -> str:
        self.complete_calls.append({"system": system, "messages": messages})
        return self._decide(system, messages)

    async def complete_with_usage(self, *, model, system, messages, max_tokens=4096):
        self.complete_calls.append({"system": system, "messages": messages})
        return self._decide(system, messages), Usage()
```

In `complete_batch` (lines 28–39), set `usage=Usage()` on the returned `BatchResult`s:

```python
        return {
            r.custom_id: BatchResult(
                custom_id=r.custom_id,
                ok=True,
                text=self._decide(r.system, r.messages),
                usage=Usage(),
            )
            for r in reqs
        }
```

In the subclasses `_TaggedFailBatchClient` and `_ClusterFailBatchClient`, the success-path `BatchResult`s also need `usage=Usage()`. In `_TaggedFailBatchClient.complete_batch` change the non-tainted branch:

```python
            else:
                out[r.custom_id] = BatchResult(
                    custom_id=r.custom_id, ok=True, text=self._decide(r.system, r.messages), usage=Usage()
                )
```

In `_ClusterFailBatchClient.complete_batch` change the success branch:

```python
            else:
                new_ns = [s["n"] for s in payload["new_stories"]]
                out[r.custom_id] = BatchResult(
                    custom_id=r.custom_id,
                    ok=True,
                    text=json.dumps(
                        {
                            "events": [
                                {
                                    "existing": None,
                                    "type": "trailer",
                                    "confidence": "confirmed",
                                    "stories": new_ns,
                                }
                            ]
                        }
                    ),
                    usage=Usage(),
                )
```

The `test_batched_cluster_failure_is_isolated_per_film` test destructures `_cluster_stage_batched`'s return into a 3-tuple (line 505): `events_created, stories_clustered, stories_rejected = await _cluster_stage_batched(...)`. That helper now returns a **4-tuple**. Update that line to:

```python
    events_created, stories_clustered, stories_rejected, _usage = await _cluster_stage_batched(
```

(The `test_flag_off_uses_sequential_only` / `test_flag_on_uses_batch_for_stage1` tests count `complete_calls`; keeping `complete_with_usage` appending to `complete_calls` preserves `_stage1_complete_calls`.)

- [ ] **Step 13: Run the full link pipeline integration tests to verify they pass**

Run: `task test -- tests/integration/link/test_pipeline.py`
Expected: PASS — all parametrized link/cluster path tests green, including failure-isolation and flag-routing.

- [ ] **Step 14: Confirm the validate/diagnose scripts need no change**

Re-read `scripts/validate_linking.py` (around line 72) and `scripts/diagnose_linking.py` (around line 51): both `await link_story_batch(...)` and discard the return value, and both pass an `AnthropicClient` (which has `complete_with_usage`). No edit needed. Do not touch them.

- [ ] **Step 15: Run the whole suite + lint/typecheck/format**

```bash
task test
task format
task lint
task typecheck
```

Expected: full suite PASS; lint/typecheck green. (Running the whole suite avoids the known single-integration-file loop quirk and catches any fake the earlier scoped runs missed.)

- [ ] **Step 16: Commit Task 4**

```bash
task format
git add src/upmovies/link/linker.py src/upmovies/link/cluster.py src/upmovies/link/pipeline.py tests/unit/link/test_linker.py tests/integration/link/test_cluster.py tests/integration/link/test_pipeline.py tests/integration/link/test_pipeline_usage.py
git commit -m "feat: capture per-stage LLM usage in the link pipeline

link_story_batch and cluster_film_events now return (Result, Usage) and call
complete_with_usage; the batched stage helpers aggregate BatchResult.usage.
run_link_ingest accumulates link and cluster usage and records one
run_llm_usage row per stage (model + batched flag from the path taken).

Refs NEU-375."
git push
```

---

## Task 5: Thread usage through the synthesize pipeline and record the `summarize` row

`summarize_event` returns `(SummaryResult, Usage)` via `complete_with_usage`; the batched path aggregates `BatchResult.usage`. `run_synthesize_ingest` accumulates a `summarize` stage `Usage` and records it (model = `settings.summary_model`; `batched` = `summary_use_batches`).

**Files:**
- Modify: `src/upmovies/synthesize/summarizer.py` (`Completer` protocol → `complete_with_usage`; `summarize_event` → `(SummaryResult, Usage)`)
- Modify: `src/upmovies/synthesize/pipeline.py` (stage helpers return usage; `run_synthesize_ingest` records `summarize`; add imports)
- Modify: `tests/unit/synthesize/test_summarizer.py` (`FakeCompleter` → `complete_with_usage`; the 2 `summarize_event` call sites destructure)
- Modify: `tests/integration/synthesize/test_pipeline.py` (`FakeSummaryClient.complete` → `complete_with_usage`; `BatchResult`s set `usage=`)
- Create: `tests/integration/synthesize/test_pipeline_usage.py`

**Interfaces:**
- Consumes: `record_llm_usage` (Task 3), `Usage`.
- Produces:
  - summarizer `Completer` Protocol: `async def complete_with_usage(...) -> tuple[str, Usage]`
  - `async def summarize_event(...) -> tuple[SummaryResult, Usage]`
  - `_summary_stage_sequential` / `_summary_stage_batched` → `tuple[int, int, int, Usage]` (new, refreshed, failed, aggregated summarize usage)
  - `run_synthesize_ingest` unchanged signature, side-effect: writes a `summarize` row.

- [ ] **Step 1: Write the failing synthesize-usage test**

Create `tests/integration/synthesize/test_pipeline_usage.py`:

```python
import json
from datetime import UTC, datetime

from sqlalchemy import select

from upmovies.catalog.models import Film
from upmovies.ingest.models import RunLLMUsage
from upmovies.ingest.runs import create_run
from upmovies.llm.client import BatchResult, Usage
from upmovies.news.models import Event, EventStory, Story
from upmovies.synthesize.pipeline import run_synthesize_ingest


class UsageSummaryClient:
    def __init__(self, usage: Usage):
        self._usage = usage

    async def complete_with_usage(self, *, model, system, messages, max_tokens=4096):
        return json.dumps({"summary": "A neutral update."}), self._usage

    async def complete_batch(self, requests, *, poll_interval=15.0, timeout=3600.0) -> dict:
        return {
            r.custom_id: BatchResult(
                custom_id=r.custom_id,
                ok=True,
                text=json.dumps({"summary": "A neutral update."}),
                usage=self._usage,
            )
            for r in requests
        }


async def _event(session):
    film = Film(tmdb_id=1, title="Runner")
    session.add(film)
    await session.flush()
    story = Story(
        source="Deadline",
        url="https://e/1",
        title="Headline",
        published_at=datetime.now(UTC),
        raw={"summary": "A dek."},
    )
    session.add(story)
    await session.flush()
    event = Event(
        film_id=film.id, event_type="casting", confidence="confirmed", occurred_at=datetime.now(UTC)
    )
    session.add(event)
    await session.flush()
    session.add(EventStory(event_id=event.id, story_id=story.id))
    await session.flush()
    return event


async def test_run_synthesize_records_summarize_usage_sequential(session):
    await _event(session)
    await session.commit()
    run_id = await create_run(session, kind="synthesize")
    await session.commit()

    await run_synthesize_ingest(
        session_factory=lambda: session,
        client=UsageSummaryClient(Usage(input_tokens=42, output_tokens=8)),
        run_id=run_id,
        model="claude-haiku-4-5",
        prompt_version="1",
        use_batches=False,
    )

    row = (
        await session.execute(
            select(RunLLMUsage).where(RunLLMUsage.run_id == run_id),
            execution_options={"populate_existing": True},
        )
    ).scalar_one()
    assert row.stage == "summarize"
    assert row.model == "claude-haiku-4-5"
    assert row.batched is False
    assert row.input_tokens == 42
    assert row.output_tokens == 8


async def test_run_synthesize_records_summarize_usage_batched(session):
    await _event(session)
    await session.commit()
    run_id = await create_run(session, kind="synthesize")
    await session.commit()

    await run_synthesize_ingest(
        session_factory=lambda: session,
        client=UsageSummaryClient(Usage(input_tokens=5)),
        run_id=run_id,
        model="claude-haiku-4-5",
        prompt_version="1",
        use_batches=True,
    )

    row = (
        await session.execute(select(RunLLMUsage).where(RunLLMUsage.run_id == run_id))
    ).scalar_one()
    assert row.stage == "summarize"
    assert row.batched is True
    assert row.input_tokens == 5
```

- [ ] **Step 2: Run the new synthesize-usage test to verify it fails**

Run: `task test -- tests/integration/synthesize/test_pipeline_usage.py`
Expected: FAIL — `run_synthesize_ingest` finishes but writes no `run_llm_usage` row, so `.scalar_one()` raises `NoResultFound`. (The sequential path also calls `complete` today, which `UsageSummaryClient` lacks, so it fails until Steps 3–5 land.)

- [ ] **Step 3: Switch the summarizer `Completer` protocol + `summarize_event` to usage**

In `src/upmovies/synthesize/summarizer.py`:

Change the import on line 12 from:

```python
from upmovies.llm.client import BatchRequest, BatchResult
```

to:

```python
from upmovies.llm.client import BatchRequest, BatchResult, Usage
```

Replace the `Completer` Protocol (lines 81–89):

```python
class Completer(Protocol):
    async def complete(
        self,
        *,
        model: str,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        max_tokens: int = ...,
    ) -> str: ...
```

with:

```python
class Completer(Protocol):
    async def complete_with_usage(
        self,
        *,
        model: str,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        max_tokens: int = ...,
    ) -> tuple[str, "Usage"]: ...
```

Replace `summarize_event` (lines 153–168):

```python
async def summarize_event(
    *, client: Completer, model: str, prompt_version: str, event: EventInput
) -> SummaryResult:
    """Sequential path: build the request, call `complete` (max_tokens pinned to `_MAX_TOKENS`
    for parity with the batched path), parse the JSON envelope, and bundle the provenance the
    caller persists into `event_summary`."""
    system, messages = build_summary_request(event)
    raw = await client.complete(
        model=model, system=system, messages=messages, max_tokens=_MAX_TOKENS
    )
    return SummaryResult(
        summary=parse_summary(raw),
        model=model,
        prompt_version=prompt_version,
        source_updated_at=event.source_updated_at,
    )
```

with:

```python
async def summarize_event(
    *, client: Completer, model: str, prompt_version: str, event: EventInput
) -> tuple[SummaryResult, Usage]:
    """Sequential path: build the request, call `complete_with_usage` (max_tokens pinned to
    `_MAX_TOKENS` for parity with the batched path), parse the JSON envelope, and bundle the
    provenance the caller persists into `event_summary` alongside the call's token `Usage`."""
    system, messages = build_summary_request(event)
    raw, usage = await client.complete_with_usage(
        model=model, system=system, messages=messages, max_tokens=_MAX_TOKENS
    )
    result = SummaryResult(
        summary=parse_summary(raw),
        model=model,
        prompt_version=prompt_version,
        source_updated_at=event.source_updated_at,
    )
    return result, usage
```

- [ ] **Step 4: Aggregate usage in the two synthesize stage helpers**

In `src/upmovies/synthesize/pipeline.py`:

Change the imports. Current lines 18–19:

```python
from upmovies.ingest.runs import finalize_run, record_progress
from upmovies.news.models import Event, EventStory, EventSummary, Story
```

Replace with:

```python
from upmovies.ingest.runs import finalize_run, record_llm_usage, record_progress
from upmovies.llm.client import Usage
from upmovies.news.models import Event, EventStory, EventSummary, Story
```

**`_summary_stage_sequential`** — change to `tuple[int, int, int, Usage]`, destructure `summarize_event`, accumulate usage:

```python
async def _summary_stage_sequential(
    *,
    session_factory: SessionFactory,
    client: SummaryClient,
    run_id: UUID,
    model: str,
    prompt_version: str,
    pending: list[_PendingEvent],
) -> tuple[int, int, int, Usage]:
    new = refreshed = failed = 0
    total_usage = Usage()
    for pe in pending:
        try:
            result, usage = await summarize_event(
                client=client, model=model, prompt_version=prompt_version, event=pe.event_input
            )
            async with _owned_session(session_factory) as s:
                await _upsert_summary(s, pe.event_id, result)
                await record_progress(s, run_id, processed_delta=1)
                await s.commit()
            total_usage += usage
            if pe.is_new:
                new += 1
            else:
                refreshed += 1
        except Exception:
            log.exception("summarize failed for event %s", pe.event_id)
            async with _owned_session(session_factory) as s:
                await record_progress(s, run_id, failed_delta=1)
                await s.commit()
            failed += 1
    return new, refreshed, failed, total_usage
```

**`_summary_stage_batched`** — change to `tuple[int, int, int, Usage]`. The `return 0, 0, 0` (empty pending) becomes `return 0, 0, 0, Usage()`; the submit-failure `return 0, 0, len(requests)` becomes `return 0, 0, len(requests), Usage()`. Aggregate `result.usage` from each ok request and return `new, refreshed, failed, total_usage`. The body:

```python
async def _summary_stage_batched(
    *,
    session_factory: SessionFactory,
    client: SummaryClient,
    run_id: UUID,
    model: str,
    prompt_version: str,
    pending: list[_PendingEvent],
) -> tuple[int, int, int, Usage]:
    if not pending:
        return 0, 0, 0, Usage()

    by_id = {str(pe.event_id): pe for pe in pending}
    requests = [
        build_summary_batch_request(custom_id=str(pe.event_id), model=model, event=pe.event_input)
        for pe in pending
    ]

    try:
        results = await client.complete_batch(requests)
    except Exception:
        log.exception("summary batch submit of %d events failed", len(requests))
        async with _owned_session(session_factory) as s:
            await record_progress(s, run_id, failed_delta=len(requests))
            await s.commit()
        return 0, 0, len(requests), Usage()

    new = refreshed = failed = 0
    total_usage = Usage()
    for custom_id, pe in by_id.items():
        result = results.get(custom_id)
        try:
            if result is None or not result.ok:
                detail = result.error_type if result else "missing"
                raise RuntimeError(f"summary for event {custom_id} unavailable: {detail}")
            summary_result = SummaryResult(
                summary=parse_summary(result.text),
                model=model,
                prompt_version=prompt_version,
                source_updated_at=pe.event_input.source_updated_at,
            )
            async with _owned_session(session_factory) as s:
                await _upsert_summary(s, pe.event_id, summary_result)
                await record_progress(s, run_id, processed_delta=1)
                await s.commit()
            if result.usage is not None:
                total_usage += result.usage
            if pe.is_new:
                new += 1
            else:
                refreshed += 1
        except Exception:
            log.exception("summary apply failed for event %s", custom_id)
            async with _owned_session(session_factory) as s:
                await record_progress(s, run_id, failed_delta=1)
                await s.commit()
            failed += 1
    return new, refreshed, failed, total_usage
```

- [ ] **Step 5: Record the `summarize` row in `run_synthesize_ingest`**

In `src/upmovies/synthesize/pipeline.py`, `run_synthesize_ingest`, replace the stage call (lines 237–245):

```python
    stage = _summary_stage_batched if use_batches else _summary_stage_sequential
    new, refreshed, failed = await stage(
        session_factory=session_factory,
        client=client,
        run_id=run_id,
        model=model,
        prompt_version=prompt_version,
        pending=pending,
    )
```

with:

```python
    stage = _summary_stage_batched if use_batches else _summary_stage_sequential
    new, refreshed, failed, summary_usage = await stage(
        session_factory=session_factory,
        client=client,
        run_id=run_id,
        model=model,
        prompt_version=prompt_version,
        pending=pending,
    )
    async with _owned_session(session_factory) as s:
        await record_llm_usage(
            s, run_id, stage="summarize", model=model, batched=use_batches, usage=summary_usage
        )
        await s.commit()
```

- [ ] **Step 6: Run the new synthesize-usage test to verify it passes**

Run: `task test -- tests/integration/synthesize/test_pipeline_usage.py`
Expected: PASS — both tests green: a `summarize` row with the right model, `batched` flag, and tokens.

- [ ] **Step 7: Update the summarizer unit-test fake + call sites**

In `tests/unit/synthesize/test_summarizer.py`, replace `FakeCompleter` (lines 26–35):

```python
class FakeCompleter:
    def __init__(self, response: str):
        self._response = response
        self.calls: list[dict] = []

    async def complete_with_usage(self, *, model, system, messages, max_tokens=4096):
        from upmovies.llm.client import Usage

        self.calls.append(
            {"model": model, "system": system, "messages": messages, "max_tokens": max_tokens}
        )
        return self._response, Usage()
```

Update the two `summarize_event` call sites. `test_summarize_event_returns_result_with_provenance` (line 106):

```python
    result, _usage = await summarize_event(
        client=client, model="claude-haiku-4-5", prompt_version="1", event=event
    )
```

`test_summarize_event_prompt_includes_every_member_story` (line 126):

```python
    await summarize_event(client=client, model="m", prompt_version="1", event=event)
```

(This call discards the return already, so destructuring isn't required — but it still works because Python ignores an un-bound tuple. Leave as-is; only the provenance test needs the `result, _usage` unpack.)

- [ ] **Step 8: Run the summarizer unit tests to verify they pass**

Run: `task test -- tests/unit/synthesize/test_summarizer.py`
Expected: PASS — all summarizer tests green (provenance + `max_tokens` parity assertions intact; the batch-request and parse tests never touched the client).

- [ ] **Step 9: Update the synthesize pipeline integration-test fakes to carry usage**

In `tests/integration/synthesize/test_pipeline.py`, the `FakeSummaryClient` (lines 176–198) has `complete` (sequential) and `complete_batch` without `usage`. Replace the `complete` method with `complete_with_usage` and set `usage=` on the batch results:

```python
class FakeSummaryClient:
    """Serves both surfaces. `complete_with_usage` (sequential) and `complete_batch` (batched)
    both return the JSON summary envelope the service expects."""

    def __init__(self, summary="A neutral update."):
        self._summary = summary
        self.complete_calls = 0
        self.batch_requests = None

    async def complete_with_usage(self, *, model, system, messages, max_tokens=4096):
        from upmovies.llm.client import Usage

        self.complete_calls += 1
        return json.dumps({"summary": self._summary}), Usage()

    async def complete_batch(self, requests, *, poll_interval=15.0, timeout=3600.0) -> dict:
        from upmovies.llm.client import BatchResult, Usage

        self.batch_requests = list(requests)
        return {
            r.custom_id: BatchResult(
                custom_id=r.custom_id,
                ok=True,
                text=json.dumps({"summary": self._summary}),
                usage=Usage(),
            )
            for r in self.batch_requests
        }
```

In `_FailOneCompleter` (lines 278–285) the override is `complete` — rename it to `complete_with_usage` and return a tuple on success:

```python
class _FailOneCompleter(FakeSummaryClient):
    """Raises for the event whose film title starts 'FAIL', succeeds otherwise."""

    async def complete_with_usage(self, *, model, system, messages, max_tokens=4096):
        from upmovies.llm.client import Usage

        payload = json.loads(messages[0]["content"])
        if payload["film"].startswith("FAIL"):
            raise RuntimeError("boom")
        return json.dumps({"summary": self._summary}), Usage()
```

In `_BatchFailOne` (lines 362–377) the success branch `BatchResult` needs `usage=Usage()`:

```python
            else:
                out[r.custom_id] = BatchResult(
                    custom_id=r.custom_id, ok=True, text=json.dumps({"summary": "ok."}), usage=Usage()
                )
```

Add `Usage` to that test's imports if not present (the module already imports `from upmovies.llm.client import BatchResult` at line 10 — extend to `from upmovies.llm.client import BatchResult, Usage`, or keep the local `from upmovies.llm.client import Usage` imports shown above — pick one consistently; the top-level import is cleaner, so change line 10 to `from upmovies.llm.client import BatchResult, Usage` and drop the inline imports).

`test_batched_request_mapping` asserts `client.complete_calls == 0` for the batched path — preserved, because `complete_with_usage` (not `complete_batch`) increments `complete_calls`.

- [ ] **Step 10: Run the synthesize pipeline integration tests to verify they pass**

Run: `task test -- tests/integration/synthesize/test_pipeline.py`
Expected: PASS — all path/failure-isolation/prompt-version tests green, including `test_sequential_failure_is_isolated_per_event` and `test_batched_request_mapping`.

- [ ] **Step 11: Run the whole suite + lint/typecheck/format**

```bash
task test
task format
task lint
task typecheck
```

Expected: full suite PASS; lint/typecheck green.

- [ ] **Step 12: Commit Task 5**

```bash
task format
git add src/upmovies/synthesize/summarizer.py src/upmovies/synthesize/pipeline.py tests/unit/synthesize/test_summarizer.py tests/integration/synthesize/test_pipeline.py tests/integration/synthesize/test_pipeline_usage.py
git commit -m "feat: capture summarize LLM usage in the synthesize pipeline

summarize_event now returns (SummaryResult, Usage) via complete_with_usage;
the batched path aggregates BatchResult.usage. run_synthesize_ingest
accumulates the summarize-stage usage and records one run_llm_usage row
(model + batched flag).

Refs NEU-375."
git push
```

---

## Task 6: DTOs + admin_runs serialization (no N+1)

Surface the persisted per-stage usage through the run API. Add `RunLLMUsageOut`, give `RunOut` an `llm_usage` list, add a relationship on `IngestRun`, and eager-load it with `selectinload` in both `/admin/runs` endpoints.

**Files:**
- Modify: `src/upmovies/ingest/dto.py` (add `RunLLMUsageOut`; `RunOut.llm_usage`)
- Modify: `src/upmovies/ingest/models.py` (add `IngestRun.llm_usage` relationship + back-reference on `RunLLMUsage`)
- Modify: `src/upmovies/routers/admin_runs.py` (`selectinload(IngestRun.llm_usage)` on both queries)
- Modify: `tests/integration/routers/test_admin_runs.py` (assert `llm_usage` serializes; assert no N+1 via selectinload)

**Interfaces:**
- Consumes: `RunLLMUsage` (Task 2), `selectinload`.
- Produces:
  - `class RunLLMUsageOut(BaseModel)` — `model_config = ConfigDict(from_attributes=True)`; fields `stage: str`, `model: str`, `batched: bool`, `input_tokens: int`, `output_tokens: int`, `cache_read_input_tokens: int`, `cache_creation_input_tokens: int`, `cost_usd: float`.
  - `RunOut.llm_usage: list[RunLLMUsageOut] = []`
  - `IngestRun.llm_usage: Mapped[list[RunLLMUsage]]` relationship (lazy by default; eager-loaded in the router).

- [ ] **Step 1: Write the failing admin_runs serialization test**

Append to `tests/integration/routers/test_admin_runs.py`:

```python
async def test_run_detail_includes_llm_usage(admin_authed_client, session):
    from decimal import Decimal

    from upmovies.ingest.models import RunLLMUsage

    tmdb, _ = await _seed_runs(session)
    link = IngestRun(kind="link", status="succeeded")
    session.add(link)
    await session.commit()
    await session.refresh(link)
    session.add_all(
        [
            RunLLMUsage(
                run_id=link.id,
                stage="link",
                model="claude-haiku-4-5",
                batched=True,
                input_tokens=100,
                output_tokens=10,
                cache_read_input_tokens=900,
                cache_creation_input_tokens=50,
                cost_usd=Decimal("0.001234"),
            ),
            RunLLMUsage(
                run_id=link.id,
                stage="cluster",
                model="claude-sonnet-4-6",
                batched=True,
                input_tokens=200,
                output_tokens=20,
                cache_read_input_tokens=0,
                cache_creation_input_tokens=0,
                cost_usd=Decimal("0.005000"),
            ),
        ]
    )
    await session.commit()

    r = await admin_authed_client.get(f"/admin/runs/{link.id}")
    assert r.status_code == 200
    body = r.json()
    usage = {u["stage"]: u for u in body["llm_usage"]}
    assert set(usage) == {"link", "cluster"}
    assert usage["link"]["model"] == "claude-haiku-4-5"
    assert usage["link"]["batched"] is True
    assert usage["link"]["input_tokens"] == 100
    assert usage["link"]["cache_read_input_tokens"] == 900
    assert usage["link"]["cost_usd"] == 0.001234
    assert usage["cluster"]["model"] == "claude-sonnet-4-6"


async def test_run_list_includes_llm_usage(admin_authed_client, session):
    from decimal import Decimal

    from upmovies.ingest.models import RunLLMUsage

    link = IngestRun(kind="link", status="succeeded")
    session.add(link)
    await session.commit()
    await session.refresh(link)
    session.add(
        RunLLMUsage(
            run_id=link.id,
            stage="link",
            model="claude-haiku-4-5",
            batched=False,
            input_tokens=5,
            cost_usd=Decimal("0.000005"),
        )
    )
    await session.commit()

    r = await admin_authed_client.get("/admin/runs")
    assert r.status_code == 200
    rows = {row["id"]: row for row in r.json()}
    assert rows[str(link.id)]["llm_usage"][0]["stage"] == "link"


async def test_run_without_usage_serializes_empty_list(admin_authed_client, session):
    tmdb, _ = await _seed_runs(session)
    r = await admin_authed_client.get(f"/admin/runs/{tmdb.id}")
    assert r.status_code == 200
    assert r.json()["llm_usage"] == []
```

- [ ] **Step 2: Run the admin_runs test to verify it fails**

Run: `task test -- tests/integration/routers/test_admin_runs.py`
Expected: FAIL — `test_run_detail_includes_llm_usage` raises `KeyError: 'llm_usage'` (the serialized body has no such key). The pre-existing admin_runs tests still pass.

- [ ] **Step 3: Add the relationship to the ORM models**

In `src/upmovies/ingest/models.py`:

Change the ORM import on line 6 from:

```python
from sqlalchemy.orm import Mapped, mapped_column
```

to:

```python
from sqlalchemy.orm import Mapped, mapped_column, relationship
```

Add a relationship to `IngestRun` (after its `error` column, end of the class):

```python
    llm_usage: Mapped[list["RunLLMUsage"]] = relationship(
        "RunLLMUsage", cascade="all, delete-orphan", back_populates="run"
    )
```

Add the back-reference to `RunLLMUsage` (after its `cost_usd` column):

```python
    run: Mapped["IngestRun"] = relationship("IngestRun", back_populates="llm_usage")
```

- [ ] **Step 4: Add the DTOs**

In `src/upmovies/ingest/dto.py`, add `RunLLMUsageOut` above `RunOut`, and the `llm_usage` field on `RunOut`:

```python
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class RunLLMUsageOut(BaseModel):
    """Per-stage LLM token usage + estimated dollar cost for one run, surfaced to the admin UI."""

    model_config = ConfigDict(from_attributes=True)

    stage: str
    model: str
    batched: bool
    input_tokens: int
    output_tokens: int
    cache_read_input_tokens: int
    cache_creation_input_tokens: int
    cost_usd: float


class RunOut(BaseModel):
    """Read model for an ingest run, surfaced to the admin UI."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    kind: str
    status: str
    started_at: datetime
    finished_at: datetime | None
    items_processed: int
    items_failed: int
    last_progress_at: datetime | None
    detail: str | None
    error: str | None
    llm_usage: list[RunLLMUsageOut] = []
```

- [ ] **Step 5: Eager-load the relationship in both endpoints**

In `src/upmovies/routers/admin_runs.py`:

Change the imports. Current lines 9–15:

```python
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from upmovies.deps import get_session, require_current_admin
from upmovies.ingest.dto import RunOut
from upmovies.ingest.models import IngestRun
```

Replace with:

```python
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from upmovies.deps import get_session, require_current_admin
from upmovies.ingest.dto import RunOut
from upmovies.ingest.models import IngestRun
```

In `list_runs` (lines 24–32), add the eager load:

```python
@router.get("", response_model=list[RunOut])
async def list_runs(
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_session),
) -> list[IngestRun]:
    rows = (
        await db.execute(
            select(IngestRun)
            .options(selectinload(IngestRun.llm_usage))
            .order_by(IngestRun.started_at.desc())
            .limit(limit)
        )
    ).scalars()
    return list(rows)
```

In `get_run` (lines 35–43), add the eager load:

```python
@router.get("/{run_id}", response_model=RunOut)
async def get_run(
    run_id: UUID,
    db: AsyncSession = Depends(get_session),
) -> IngestRun:
    row = (
        await db.execute(
            select(IngestRun)
            .options(selectinload(IngestRun.llm_usage))
            .where(IngestRun.id == run_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
    return row
```

- [ ] **Step 6: Run the admin_runs test to verify it passes**

Run: `task test -- tests/integration/routers/test_admin_runs.py`
Expected: PASS — `test_run_detail_includes_llm_usage`, `test_run_list_includes_llm_usage`, `test_run_without_usage_serializes_empty_list`, and all pre-existing admin_runs tests green. (`selectinload` issues one extra `IN (...)` query for the whole result set, so the list endpoint is not N+1.)

- [ ] **Step 7: Run the whole suite + lint/typecheck/format**

```bash
task test
task format
task lint
task typecheck
```

Expected: full suite PASS; lint/typecheck green. Pay attention that `pyright` is happy with the `Mapped[list["RunLLMUsage"]]` forward ref and the `relationship(...)` back_populates wiring.

- [ ] **Step 8: Commit Task 6**

```bash
task format
git add src/upmovies/ingest/dto.py src/upmovies/ingest/models.py src/upmovies/routers/admin_runs.py tests/integration/routers/test_admin_runs.py
git commit -m "feat: expose per-stage LLM usage on the admin runs API

Add RunLLMUsageOut and RunOut.llm_usage, an IngestRun.llm_usage relationship,
and selectinload it in both /admin/runs endpoints (list endpoint stays single-
query, no N+1). Per-stage tokens + estimated cost now reach the admin UI.

Refs NEU-375."
git push
```

---

## Self-review

- **Spec coverage (T1 acceptance):** a completed run row carries input/output/cache_read/cache_creation tokens + estimated `$` per stage (Tasks 2–5) → reachable via the run API (Task 6); shared pricing helper lifted from `measure_link_cost.py` with the script refactored onto it, no behaviour change (Task 1); capture on both sequential and batch paths, aggregated per stage (Tasks 4, 5); migration included (Task 2); unit + integration tests cover capture + aggregation + persistence + serialization (every task). Stage labels exactly `"link"`/`"cluster"`/`"summarize"`; `link`-kind emits link+cluster, `synthesize`-kind emits summarize (Tasks 4, 5) — matches the shared interface contract the five sibling tickets consume.
- **Contract fidelity:** `pricing.py` exports the exact constants, `Rates`, `HAIKU_4_5`, `SONNET_4_6`, `_RATES`, `rates_for` (KeyError on unknown), `price` (Task 1). `RunLLMUsage` has the exact columns, CHECK, unique, FK, index (Task 2). `record_llm_usage` has the exact signature and UPSERTs on `uq_run_llm_usage_run_stage` (Task 3). `RunLLMUsageOut` has the exact eight fields incl. `cost_usd: float`; `RunOut.llm_usage: list[...] = []`; `selectinload` on both endpoints (Task 6).
- **Placeholder scan:** none. Every test step shows REAL test code; every implementation step shows REAL old→new code; every run step states the exact expected PASS/FAIL text. No "similar to Task N" / "add error handling" / TODO/TBD.
- **Type consistency across tasks:** `link_story_batch → tuple[BatchLinkResult, Usage]`, `cluster_film_events → tuple[ClusterResult, Usage]`, `summarize_event → tuple[SummaryResult, Usage]` — every caller (production stage helpers + scripts that discard the return + all unit/integration test call sites) is updated in the same task that changes the signature (Tasks 4, 5). The four stage helpers' arities (`_link_stage_* → 3-tuple`, `_cluster_stage_* → 4-tuple`, `_summary_stage_* → 4-tuple`) are destructured consistently in `run_link_ingest`/`run_synthesize_ingest` and in the one test that calls `_cluster_stage_batched` directly. The `Completer` protocols (linker + summarizer) drop `complete` for `complete_with_usage`; `AnthropicClient` satisfies both since it already implements `complete_with_usage`. `cost_usd` is `Numeric(12,6)` in the DB (`Decimal` in Python) and serialized as `float` in the DTO — the `record_llm_usage` test asserts `Decimal("6.000000")` and the DTO test asserts `0.001234`, consistent with that boundary.
- **Test-suite blast radius (verified against the real fakes):** every existing fake that only implemented `complete` (`test_linker.FakeClient`, `test_cluster.FakeClient`, `test_pipeline.FakeClient` + its two subclasses, `test_summarizer.FakeCompleter`, `test_pipeline(synth).FakeSummaryClient` + `_FailOneCompleter`/`_BatchFailOne`) gains `complete_with_usage` and sets `usage=` on its `BatchResult`s in the same task — these are the only places that would otherwise break, and they are each enumerated with the exact edit.
