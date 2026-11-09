# NEU-454 Source-Quality Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate low-trust news domains so a beat sourced only from low-trust publishers cannot be `confirmed` (it becomes `rumored`), admin-blocked domains are dropped from ingestion, and admins can view/override per-domain trust tiers.

**Architecture:** A new `news.source_domain` table caches an LLM-assigned trust tier per resolved publisher domain (judge-once). A new SOURCE-JUDGE sub-stage in the link pipeline runs **after LINK, before CLUSTER**: it resolves Google-News URLs for linked-but-unclustered stories, judges any unknown domains, and hard-drops admin-blocked ones. Clustering then downgrades an event's `confidence` to `rumored` when every attached story is low-trust. Admin endpoints (session + CSRF) expose the table and a per-domain override.

**Tech Stack:** Python 3.13, SQLAlchemy 2 async + asyncpg, Alembic, FastAPI, Pydantic v2, Anthropic SDK, `tldextract` (new), pytest + respx. All commands run in-container via `task`.

## Global Constraints

- **No local Python.** Every check runs via `task`: `task test`, `task lint`, `task typecheck`, `task format`, `task migrate`, `task makemigration -- "msg"`, `task build` (only after `pyproject.toml` dep changes). Container must be up (`task up`).
- **TDD.** Write the failing test first; watch it fail; implement minimal code; watch it pass; commit.
- **Green gate before "done":** `task test`, `task lint`, `task typecheck` all pass; `task format` applied.
- **Type hints:** modern `X | None` / `X | Y`. **No** `from __future__ import annotations`. ruff line-length 100, rules E,F,W,I,B,UP.
- **Layering:** routers → services → repos → models; pure DB I/O modules never commit — **the caller owns the transaction**.
- **Two admin auth modes stay separate:** human-facing admin uses `require_current_admin` + `require_csrf` (session cookie + `is_admin`); never the `ADMIN_TOKEN` bearer for these.
- **Never hit the live network in tests** (respx / fakes only). `tldextract` is configured with `suffix_list_urls=()` so it uses its bundled Public-Suffix snapshot and never fetches.
- **Commits:** Conventional Commits subject; **no** Linear ID in the subject (optional `Refs NEU-454.` in body); **no** `🤖` footer; **no** `Co-Authored-By`.
- **Migrations:** add the model first (tests build the schema from models via `create_all`), then `task makemigration`, review the file, `task migrate`. New revision's `down_revision` is the current head `46406c2cc268`.

## File Structure

- **Create** `src/upmovies/news/source_quality.py` — pure helpers (domain normalization, effective-tier resolution, confidence downgrade), the LLM judge (request build / parse / call), and pure DB I/O (get / upsert / list / set-override). No commits.
- **Create** `src/upmovies/link/source_stage.py` — the SOURCE-JUDGE sub-stage orchestration (resolve → judge → hard-drop) with its own owned sessions, mirroring `synthesize/url_resolution.py`.
- **Create** `src/upmovies/routers/sources_admin.py` — human-facing admin router (`/admin/sources`).
- **Modify** `src/upmovies/news/models.py` — add the `SourceDomain` model.
- **Modify** `src/upmovies/link/cluster.py` — confidence downgrade inside `apply_cluster_decisions`.
- **Modify** `src/upmovies/link/pipeline.py` — call the sub-stage between LINK and CLUSTER; thread `unresolved_tier` into the cluster stages.
- **Modify** `src/upmovies/config.py` — three new settings.
- **Modify** `src/upmovies/routers/ingest_admin.py` — wire the new settings into `_background_link` / `run_link_ingest`.
- **Modify** `src/upmovies/main.py` — register the new router.
- **Modify** `pyproject.toml` — add `tldextract`.
- **Create** migration `migrations/versions/<hash>_add_source_domain_table.py`.
- **Create** tests under `tests/unit/news/`, `tests/unit/link/`, `tests/integration/link/`, `tests/integration/routers/`.

---

### Task 1: Pure helpers — domain normalization & tier logic

**Files:**
- Modify: `pyproject.toml` (add `tldextract`)
- Create: `src/upmovies/news/source_quality.py`
- Test: `tests/unit/news/test_source_quality_pure.py`

**Interfaces:**
- Produces:
  - `normalize_domain(value: str | None) -> str | None`
  - `domain_for_story(*, url: str, resolved_url: str | None) -> str | None`
  - `TIER_RANK: dict[str, int]`, `VALID_TIERS: frozenset[str]`, `VALID_OVERRIDES: frozenset[str]`
  - `effective_tier(*, llm_tier: str | None, admin_override: str, unresolved_default: str) -> str`
  - `best_tier(tiers: Iterable[str], *, default: str) -> str`
  - `downgrade_confidence(confidence: str, best_tier: str) -> str`

- [ ] **Step 1: Add the dependency**

In `pyproject.toml`, add to `[project].dependencies` (keep the list alphabetical-ish, place after `sqlalchemy` line is fine):

```toml
    "tldextract>=5.1",
```

- [ ] **Step 2: Build the image so the dep installs**

Run: `task build`
Expected: build completes; `tldextract` installed into the image.

- [ ] **Step 3: Write the failing test**

Create `tests/unit/news/test_source_quality_pure.py`:

```python
from upmovies.news.source_quality import (
    best_tier,
    domain_for_story,
    downgrade_confidence,
    effective_tier,
    normalize_domain,
)


def test_normalize_domain_strips_subdomain_and_www():
    assert normalize_domain("https://www.mshale.com/a/b?x=1") == "mshale.com"
    assert normalize_domain("http://m.mshale.com/amp/story") == "mshale.com"


def test_normalize_domain_handles_multipart_tld():
    assert normalize_domain("https://news.bbc.co.uk/story") == "bbc.co.uk"


def test_normalize_domain_none_or_hostless():
    assert normalize_domain(None) is None
    assert normalize_domain("not a url") is None


def test_domain_for_story_prefers_resolved():
    d = domain_for_story(url="https://news.google.com/rss/articles/XYZ", resolved_url="https://variety.com/x")
    assert d == "variety.com"


def test_domain_for_story_unresolved_google_is_none():
    # An unresolved Google redirect must NOT be tagged as google.com.
    d = domain_for_story(url="https://news.google.com/rss/articles/XYZ", resolved_url=None)
    assert d is None


def test_domain_for_story_direct_publisher():
    assert domain_for_story(url="https://deadline.com/x", resolved_url=None) == "deadline.com"


def test_effective_tier_override_wins():
    assert effective_tier(llm_tier="low", admin_override="trust", unresolved_default="acceptable") == "trusted"
    assert effective_tier(llm_tier="trusted", admin_override="block", unresolved_default="acceptable") == "blocked"
    assert effective_tier(llm_tier="trusted", admin_override="allow", unresolved_default="acceptable") == "acceptable"


def test_effective_tier_none_override_uses_llm_tier():
    assert effective_tier(llm_tier="low", admin_override="none", unresolved_default="acceptable") == "low"


def test_effective_tier_missing_llm_tier_uses_default():
    assert effective_tier(llm_tier=None, admin_override="none", unresolved_default="acceptable") == "acceptable"


def test_best_tier_picks_highest_and_ignores_blocked():
    assert best_tier(["low", "acceptable", "low"], default="acceptable") == "acceptable"
    assert best_tier(["low", "blocked"], default="acceptable") == "low"
    assert best_tier([], default="acceptable") == "acceptable"


def test_downgrade_confidence_only_when_all_low():
    assert downgrade_confidence("confirmed", "low") == "rumored"
    assert downgrade_confidence("confirmed", "acceptable") == "confirmed"
    assert downgrade_confidence("rumored", "trusted") == "rumored"
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `task test -- tests/unit/news/test_source_quality_pure.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'upmovies.news.source_quality'`.

- [ ] **Step 5: Write the minimal implementation**

Create `src/upmovies/news/source_quality.py`:

```python
"""Source-quality helpers: normalize publisher domains, resolve an effective trust tier
(admin override wins over the LLM verdict), and downgrade event confidence when every
source is low-trust. Pure functions here have no DB or LLM dependency; the judge and DB
I/O live lower in this module. The caller owns any transaction."""

from collections.abc import Iterable

import tldextract

from upmovies.news.resolve import is_google_news_url

# Disable the network suffix-list fetch; rely on tldextract's bundled snapshot so this is
# deterministic and never hits the network (test rule + offline container safety).
_EXTRACT = tldextract.TLDExtract(suffix_list_urls=())

TIER_RANK: dict[str, int] = {"low": 0, "acceptable": 1, "trusted": 2}
VALID_TIERS: frozenset[str] = frozenset({"trusted", "acceptable", "low"})
VALID_OVERRIDES: frozenset[str] = frozenset({"none", "block", "allow", "trust"})
_OVERRIDE_TIER: dict[str, str] = {"block": "blocked", "trust": "trusted", "allow": "acceptable"}


def normalize_domain(value: str | None) -> str | None:
    """Registrable domain (lowercase) for a URL, e.g. `m.mshale.com/amp` -> `mshale.com`,
    `news.bbc.co.uk` -> `bbc.co.uk`. None when there is no registrable domain."""
    if not value:
        return None
    registered = _EXTRACT(value).registered_domain
    return registered.lower() or None


def domain_for_story(*, url: str, resolved_url: str | None) -> str | None:
    """The publisher domain to gate on. Prefer the resolved publisher URL; an UNRESOLVED
    Google-News redirect returns None (treated as the neutral default tier — we won't tag
    it as `google.com`)."""
    target = resolved_url or url
    if is_google_news_url(target):
        return None
    return normalize_domain(target)


def effective_tier(*, llm_tier: str | None, admin_override: str, unresolved_default: str) -> str:
    """The tier the gate uses. Admin override wins; otherwise the cached LLM tier; otherwise
    the neutral default. Returns one of `blocked` / `trusted` / `acceptable` / `low`."""
    if admin_override in _OVERRIDE_TIER:
        return _OVERRIDE_TIER[admin_override]
    return llm_tier or unresolved_default


def best_tier(tiers: Iterable[str], *, default: str) -> str:
    """The most-trusted tier present, ignoring `blocked` (blocked stories are dropped before
    they reach here). `default` when no rankable tier is present."""
    ranked = [t for t in tiers if t in TIER_RANK]
    if not ranked:
        return default
    return max(ranked, key=lambda t: TIER_RANK[t])


def downgrade_confidence(confidence: str, best_tier: str) -> str:
    """Force `rumored` when the best available source tier is `low`; otherwise keep the
    LLM's confidence verdict."""
    return "rumored" if best_tier == "low" else confidence
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `task test -- tests/unit/news/test_source_quality_pure.py`
Expected: PASS (all 10 tests).

- [ ] **Step 7: Lint, format, typecheck**

Run: `task format && task lint && task typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add pyproject.toml src/upmovies/news/source_quality.py tests/unit/news/test_source_quality_pure.py
git commit -m "feat: add source-quality domain + tier pure helpers"
```

---

### Task 2: `SourceDomain` model + migration

**Files:**
- Modify: `src/upmovies/news/models.py`
- Test: `tests/integration/news/test_source_domain_model.py`
- Create: `migrations/versions/<hash>_add_source_domain_table.py`

**Interfaces:**
- Produces: `SourceDomain` ORM model (`news.source_domain`) with columns `domain` (PK), `llm_tier`, `llm_reason`, `llm_model`, `admin_override`, `first_seen_at`, `judged_at`, `updated_at`, and CHECK constraints `ck_source_domain_tier`, `ck_source_domain_override`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/news/test_source_domain_model.py`:

```python
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from upmovies.news.models import SourceDomain


async def test_insert_and_read_source_domain(session):
    now = datetime.now(UTC)
    session.add(
        SourceDomain(
            domain="mshale.com",
            llm_tier="low",
            llm_reason="low-quality aggregator",
            llm_model="claude-haiku-4-5",
            admin_override="none",
            first_seen_at=now,
            judged_at=now,
            updated_at=now,
        )
    )
    await session.commit()
    row = (
        await session.execute(select(SourceDomain).where(SourceDomain.domain == "mshale.com"))
    ).scalar_one()
    assert row.llm_tier == "low"
    assert row.admin_override == "none"


async def test_tier_check_constraint_rejects_bad_value(session):
    now = datetime.now(UTC)
    session.add(
        SourceDomain(
            domain="bad.test", llm_tier="great", admin_override="none",
            first_seen_at=now, updated_at=now,
        )
    )
    with pytest.raises(IntegrityError):
        await session.commit()


async def test_override_check_constraint_rejects_bad_value(session):
    now = datetime.now(UTC)
    session.add(
        SourceDomain(
            domain="bad2.test", admin_override="banish",
            first_seen_at=now, updated_at=now,
        )
    )
    with pytest.raises(IntegrityError):
        await session.commit()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/integration/news/test_source_domain_model.py`
Expected: FAIL — `ImportError: cannot import name 'SourceDomain'`.

- [ ] **Step 3: Add the model**

In `src/upmovies/news/models.py`, append after `EventSummary`:

```python
class SourceDomain(Base):
    """Per-publisher-domain trust tier for the source-quality gate. `llm_tier` is assigned
    once by the LLM judge on first sighting and cached; `admin_override` (set from the admin
    UI) always wins over it. Keyed by the normalized registrable domain (e.g. `mshale.com`)."""

    __tablename__ = "source_domain"
    __table_args__ = (
        CheckConstraint(
            "llm_tier IS NULL OR llm_tier IN ('trusted', 'acceptable', 'low')",
            name="ck_source_domain_tier",
        ),
        CheckConstraint(
            "admin_override IN ('none', 'block', 'allow', 'trust')",
            name="ck_source_domain_override",
        ),
        {"schema": "news"},
    )

    domain: Mapped[str] = mapped_column(Text, primary_key=True)
    llm_tier: Mapped[str | None] = mapped_column(Text, nullable=True)
    llm_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    llm_model: Mapped[str | None] = mapped_column(Text, nullable=True)
    admin_override: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'none'")
    )
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    judged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
```

(`CheckConstraint`, `DateTime`, `Text`, `text`, `Mapped`, `mapped_column`, `datetime` are already imported in this file.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- tests/integration/news/test_source_domain_model.py`
Expected: PASS (the `session` fixture builds the table from the model via `create_all`).

- [ ] **Step 5: Generate the migration**

Run: `task makemigration -- "add source_domain table"`
Then open the generated file in `migrations/versions/`. Confirm `down_revision = '46406c2cc268'` and that `upgrade()` creates `news.source_domain` with both CHECK constraints. It should look like:

```python
def upgrade() -> None:
    op.create_table(
        'source_domain',
        sa.Column('domain', sa.Text(), nullable=False),
        sa.Column('llm_tier', sa.Text(), nullable=True),
        sa.Column('llm_reason', sa.Text(), nullable=True),
        sa.Column('llm_model', sa.Text(), nullable=True),
        sa.Column('admin_override', sa.Text(), server_default=sa.text("'none'"), nullable=False),
        sa.Column('first_seen_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('judged_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("llm_tier IS NULL OR llm_tier IN ('trusted', 'acceptable', 'low')", name='ck_source_domain_tier'),
        sa.CheckConstraint("admin_override IN ('none', 'block', 'allow', 'trust')", name='ck_source_domain_override'),
        sa.PrimaryKeyConstraint('domain'),
        schema='news',
    )


def downgrade() -> None:
    op.drop_table('source_domain', schema='news')
```

If autogen omitted a CHECK constraint or the `server_default`s, edit the file to match the block above.

- [ ] **Step 6: Apply the migration**

Run: `task migrate`
Expected: upgrades to the new head with no error.

- [ ] **Step 7: Verify migration chain is linear**

Run: `task test -- tests/integration/news/test_source_domain_model.py && task lint`
Expected: PASS + clean. (A single-head check also runs as part of full CI later.)

- [ ] **Step 8: Commit**

```bash
git add src/upmovies/news/models.py migrations/versions/ tests/integration/news/test_source_domain_model.py
git commit -m "feat: add news.source_domain table"
```

---

### Task 3: DB I/O for `source_domain`

**Files:**
- Modify: `src/upmovies/news/source_quality.py`
- Test: `tests/integration/news/test_source_quality_db.py`

**Interfaces:**
- Consumes: `SourceDomain` (Task 2); pure helpers (Task 1)
- Produces:
  - `get_source_domains(session: AsyncSession, domains: Collection[str]) -> dict[str, SourceDomain]`
  - `upsert_judgements(session: AsyncSession, verdicts: dict[str, tuple[str, str]], *, model: str, now: datetime) -> int`
  - `list_source_domains(session: AsyncSession) -> list[SourceDomain]`
  - `set_override(session: AsyncSession, *, domain: str, override: str, now: datetime) -> SourceDomain`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/news/test_source_quality_db.py`:

```python
from datetime import UTC, datetime

from upmovies.news.source_quality import (
    get_source_domains,
    list_source_domains,
    set_override,
    upsert_judgements,
)


async def test_upsert_and_get(session):
    now = datetime.now(UTC)
    n = await upsert_judgements(
        session,
        {"mshale.com": ("low", "aggregator"), "variety.com": ("trusted", "trade")},
        model="claude-haiku-4-5",
        now=now,
    )
    await session.commit()
    assert n == 2
    rows = await get_source_domains(session, ["mshale.com", "variety.com", "unknown.test"])
    assert set(rows) == {"mshale.com", "variety.com"}
    assert rows["mshale.com"].llm_tier == "low"
    assert rows["variety.com"].llm_model == "claude-haiku-4-5"
    assert rows["mshale.com"].judged_at is not None


async def test_get_empty_returns_empty(session):
    assert await get_source_domains(session, []) == {}


async def test_set_override_creates_then_updates(session):
    now = datetime.now(UTC)
    row = await set_override(session, domain="Mshale.com", override="block", now=now)
    await session.commit()
    assert row.domain == "mshale.com"  # normalized to lowercase
    assert row.admin_override == "block"
    assert row.llm_tier is None

    row2 = await set_override(session, domain="mshale.com", override="trust", now=now)
    await session.commit()
    assert row2.admin_override == "trust"
    all_rows = await list_source_domains(session)
    assert len(all_rows) == 1


async def test_set_override_preserves_llm_tier(session):
    now = datetime.now(UTC)
    await upsert_judgements(session, {"deadline.com": ("trusted", "trade")}, model="m", now=now)
    await session.commit()
    row = await set_override(session, domain="deadline.com", override="block", now=now)
    await session.commit()
    assert row.llm_tier == "trusted"
    assert row.admin_override == "block"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/integration/news/test_source_quality_db.py`
Expected: FAIL — `ImportError: cannot import name 'get_source_domains'`.

- [ ] **Step 3: Implement the DB I/O**

In `src/upmovies/news/source_quality.py`, add imports at the top (below the existing imports):

```python
from collections.abc import Collection
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from upmovies.news.models import SourceDomain
```

Then append these functions:

```python
async def get_source_domains(
    session: AsyncSession, domains: Collection[str]
) -> dict[str, SourceDomain]:
    """Look up existing rows for the given domains, keyed by domain. Missing domains are
    simply absent from the result."""
    domain_list = [d for d in {d for d in domains} if d]
    if not domain_list:
        return {}
    rows = (
        (await session.execute(select(SourceDomain).where(SourceDomain.domain.in_(domain_list))))
        .scalars()
        .all()
    )
    return {row.domain: row for row in rows}


async def upsert_judgements(
    session: AsyncSession,
    verdicts: dict[str, tuple[str, str]],
    *,
    model: str,
    now: datetime,
) -> int:
    """Insert judge verdicts for previously-unknown domains: `{domain: (tier, reason)}`.
    Existing rows are left untouched (domains are judged once). Returns rows inserted.
    Caller commits."""
    if not verdicts:
        return 0
    existing = await get_source_domains(session, list(verdicts))
    inserted = 0
    for domain, (tier, reason) in verdicts.items():
        if domain in existing:
            continue
        session.add(
            SourceDomain(
                domain=domain,
                llm_tier=tier,
                llm_reason=reason,
                llm_model=model,
                admin_override="none",
                first_seen_at=now,
                judged_at=now,
                updated_at=now,
            )
        )
        inserted += 1
    await session.flush()
    return inserted


async def list_source_domains(session: AsyncSession) -> list[SourceDomain]:
    """All known source domains, most-recently-updated first (for the admin UI)."""
    return list(
        (await session.execute(select(SourceDomain).order_by(SourceDomain.updated_at.desc())))
        .scalars()
        .all()
    )


async def set_override(
    session: AsyncSession, *, domain: str, override: str, now: datetime
) -> SourceDomain:
    """Set (or clear, via `none`) the admin override for a domain, creating the row if the
    domain has never been seen. The domain is lowercased. Caller commits."""
    key = domain.strip().lower()
    row = await session.get(SourceDomain, key)
    if row is None:
        row = SourceDomain(
            domain=key, admin_override=override, first_seen_at=now, updated_at=now
        )
        session.add(row)
    else:
        row.admin_override = override
        row.updated_at = now
    await session.flush()
    return row
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- tests/integration/news/test_source_quality_db.py`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint, format, typecheck**

Run: `task format && task lint && task typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/upmovies/news/source_quality.py tests/integration/news/test_source_quality_db.py
git commit -m "feat: add source_domain DB I/O (get/upsert/list/override)"
```

---

### Task 4: LLM domain judge

**Files:**
- Modify: `src/upmovies/news/source_quality.py`
- Test: `tests/unit/news/test_source_judge.py`

**Interfaces:**
- Consumes: `Completer` protocol (`upmovies.link.linker`), `Usage` (`upmovies.llm.client`)
- Produces:
  - `build_judge_request(items: list[dict[str, str]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]`
  - `parse_judge_verdicts(raw: str, *, domains: set[str]) -> dict[str, tuple[str, str]]`
  - `judge_domains(*, client: Completer, model: str, items: list[dict[str, str]]) -> tuple[dict[str, tuple[str, str]], Usage]`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/news/test_source_judge.py`:

```python
import json

from upmovies.llm.client import Usage
from upmovies.news.source_quality import (
    build_judge_request,
    judge_domains,
    parse_judge_verdicts,
)


def test_build_judge_request_shape():
    system, messages = build_judge_request(
        [{"domain": "mshale.com", "sample_headline": "New trailer!"}]
    )
    assert isinstance(system, list) and system[0]["type"] == "text"
    assert len(messages) == 1 and messages[0]["role"] == "user"
    payload = json.loads(messages[0]["content"])
    assert payload == [{"domain": "mshale.com", "sample_headline": "New trailer!"}]


def test_parse_judge_verdicts_keeps_known_valid():
    raw = (
        'Here you go:\n[{"domain": "mshale.com", "tier": "low", "reason": "aggregator"},'
        ' {"domain": "variety.com", "tier": "trusted", "reason": "trade"},'
        ' {"domain": "evil.test", "tier": "low", "reason": "x"},'
        ' {"domain": "variety.com", "tier": "bogus", "reason": "y"}]'
    )
    out = parse_judge_verdicts(raw, domains={"mshale.com", "variety.com"})
    assert out == {"mshale.com": ("low", "aggregator"), "variety.com": ("trusted", "trade")}


def test_parse_judge_verdicts_unparseable_returns_empty():
    assert parse_judge_verdicts("no json here", domains={"a.com"}) == {}


class _FakeClient:
    def __init__(self, text: str):
        self._text = text

    async def complete_with_usage(self, *, model, system, messages, max_tokens=...):
        return self._text, Usage(input_tokens=5, output_tokens=3)


async def test_judge_domains_calls_client_and_parses():
    client = _FakeClient('[{"domain": "mshale.com", "tier": "low", "reason": "aggregator"}]')
    verdicts, usage = await judge_domains(
        client=client,
        model="claude-haiku-4-5",
        items=[{"domain": "mshale.com", "sample_headline": "h"}],
    )
    assert verdicts == {"mshale.com": ("low", "aggregator")}
    assert usage.output_tokens == 3


async def test_judge_domains_empty_is_noop():
    client = _FakeClient("[]")
    verdicts, usage = await judge_domains(client=client, model="m", items=[])
    assert verdicts == {}
    assert usage == Usage()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/unit/news/test_source_judge.py`
Expected: FAIL — `ImportError: cannot import name 'build_judge_request'`.

- [ ] **Step 3: Implement the judge**

In `src/upmovies/news/source_quality.py`, extend the imports:

```python
import json
from typing import Any

from upmovies.link.linker import Completer
from upmovies.llm.client import Usage
```

> Note: `upmovies.link.linker` imports only from `upmovies.llm.client`, `upmovies.link.roster`, and `upmovies.news.models` — importing `Completer` here creates no import cycle (`news.source_quality` is not imported by `linker`).

Add the judge constants and functions:

```python
_JUDGE_MAX_TOKENS = 1024
_JUDGE_INSTRUCTIONS = """You are a source-quality rater for an upcoming-movies news tracker. \
You are given a JSON array of news source domains, each with one sample headline seen from \
that domain. Rate each domain's reliability for *movie/entertainment production news* into \
exactly one tier:

- "trusted": established trade or major outlet with editorial standards (e.g. variety.com, \
deadline.com, hollywoodreporter.com, apnews.com).
- "acceptable": a real outlet or reputable enthusiast site that is not a top-tier trade but \
is generally reliable for entertainment news.
- "low": content farms, SEO aggregators, auto-reposters, machine-translated scrapers, \
link-spam, or sites with no discernible editorial standard.

Judge by the domain's reputation; the sample headline is only context. Return ONLY a JSON \
array — no prose, no markdown — one object per input domain:
[{"domain": "<domain>", "tier": "trusted" | "acceptable" | "low", "reason": "<short reason>"}]"""


def _extract_json_array(text: str) -> str:
    start = text.find("[")
    end = text.rfind("]")
    if start == -1 or end == -1 or end < start:
        return text
    return text[start : end + 1]


def build_judge_request(
    items: list[dict[str, str]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """System + user blocks for the domain judge. Plain (uncached) system block: the
    instructions are well under every model's cache floor."""
    system = [{"type": "text", "text": _JUDGE_INSTRUCTIONS}]
    messages = [{"role": "user", "content": json.dumps(items)}]
    return system, messages


def parse_judge_verdicts(raw: str, *, domains: set[str]) -> dict[str, tuple[str, str]]:
    """Parse the judge's JSON array into `{domain: (tier, reason)}`. Keeps only entries whose
    domain was actually asked about and whose tier is valid; last write wins on duplicates.
    Returns `{}` on unparseable output."""
    try:
        decisions = json.loads(_extract_json_array(raw))
    except json.JSONDecodeError:
        return {}
    if not isinstance(decisions, list):
        return {}
    out: dict[str, tuple[str, str]] = {}
    for d in decisions:
        if not isinstance(d, dict):
            continue
        domain = d.get("domain")
        tier = d.get("tier")
        if domain in domains and tier in VALID_TIERS:
            out[domain] = (tier, str(d.get("reason") or ""))
    return out


async def judge_domains(
    *, client: Completer, model: str, items: list[dict[str, str]]
) -> tuple[dict[str, tuple[str, str]], Usage]:
    """Judge a batch of unknown domains in one LLM call. Returns `{domain: (tier, reason)}`
    plus token usage. No-op (`{}`, empty Usage) for empty input."""
    if not items:
        return {}, Usage()
    system, messages = build_judge_request(items)
    raw, usage = await client.complete_with_usage(
        model=model, system=system, messages=messages, max_tokens=_JUDGE_MAX_TOKENS
    )
    domains = {item["domain"] for item in items}
    return parse_judge_verdicts(raw, domains=domains), usage
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- tests/unit/news/test_source_judge.py`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint, format, typecheck**

Run: `task format && task lint && task typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/upmovies/news/source_quality.py tests/unit/news/test_source_judge.py
git commit -m "feat: add LLM domain-trust judge"
```

---

### Task 5: Confidence downgrade in clustering

**Files:**
- Modify: `src/upmovies/link/cluster.py`
- Modify: `src/upmovies/link/pipeline.py`
- Test: `tests/integration/link/test_cluster_source_gate.py`

**Interfaces:**
- Consumes: `domain_for_story`, `effective_tier`, `best_tier`, `downgrade_confidence`, `get_source_domains` (Tasks 1, 3)
- Produces:
  - `apply_cluster_decisions(session, *, plan, raw, unresolved_tier: str = "acceptable")` — now downgrades new-event `confidence` to `rumored` when every attached story is low-trust.
  - `cluster_film_events(..., unresolved_tier: str = "acceptable")`
  - `_cluster_stage_sequential(..., unresolved_tier: str)` and `_cluster_stage_batched(..., unresolved_tier: str)` in `pipeline.py`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/link/test_cluster_source_gate.py`:

```python
from datetime import UTC, datetime

from sqlalchemy import select

from upmovies.catalog.models import Film
from upmovies.link.cluster import ClusterPlan, apply_cluster_decisions
from upmovies.news.models import Event, SourceDomain, Story


async def _film(session, slug):
    film = Film(tmdb_id=abs(hash(slug)) % 10_000_000, slug=slug, title="A Film")
    session.add(film)
    await session.flush()
    return film


async def _story(session, film_id, url):
    story = Story(
        source="Google News", url=url, title="Big beat", film_id=film_id, link_status="linked",
        fetched_at=datetime.now(UTC),
    )
    session.add(story)
    await session.flush()
    return story


async def _run(session, film_id, story_ids, *, confidence):
    plan = ClusterPlan(film_id=film_id, existing_event_ids=[], unclustered_story_ids=story_ids)
    raw = (
        '{"events": [{"existing": null, "type": "casting", "confidence": "%s", "stories": [%s]}]}'
        % (confidence, ", ".join(str(i + 1) for i in range(len(story_ids))))
    )
    return await apply_cluster_decisions(session, plan=plan, raw=raw, unresolved_tier="acceptable")


async def test_all_low_trust_downgrades_to_rumored(session):
    film = await _film(session, "g-low")
    s1 = await _story(session, film.id, "https://mshale.com/a")
    session.add(SourceDomain(domain="mshale.com", llm_tier="low", admin_override="none",
                             first_seen_at=datetime.now(UTC), updated_at=datetime.now(UTC)))
    await session.flush()
    await _run(session, film.id, [s1.id], confidence="confirmed")
    event = (await session.execute(select(Event).where(Event.film_id == film.id))).scalar_one()
    assert event.confidence == "rumored"


async def test_one_trusted_source_keeps_confirmed(session):
    film = await _film(session, "g-mix")
    s1 = await _story(session, film.id, "https://mshale.com/a")
    s2 = await _story(session, film.id, "https://variety.com/b")
    now = datetime.now(UTC)
    session.add_all([
        SourceDomain(domain="mshale.com", llm_tier="low", admin_override="none", first_seen_at=now, updated_at=now),
        SourceDomain(domain="variety.com", llm_tier="trusted", admin_override="none", first_seen_at=now, updated_at=now),
    ])
    await session.flush()
    await _run(session, film.id, [s1.id, s2.id], confidence="confirmed")
    event = (await session.execute(select(Event).where(Event.film_id == film.id))).scalar_one()
    assert event.confidence == "confirmed"


async def test_unknown_domain_uses_neutral_default_keeps_confirmed(session):
    film = await _film(session, "g-unknown")
    s1 = await _story(session, film.id, "https://newsite.example/a")
    await session.flush()
    await _run(session, film.id, [s1.id], confidence="confirmed")
    event = (await session.execute(select(Event).where(Event.film_id == film.id))).scalar_one()
    assert event.confidence == "confirmed"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/integration/link/test_cluster_source_gate.py`
Expected: FAIL — `test_all_low_trust_downgrades_to_rumored` asserts `rumored` but gets `confirmed` (gate not wired yet).

- [ ] **Step 3: Wire the downgrade into `apply_cluster_decisions`**

In `src/upmovies/link/cluster.py`, add to the imports:

```python
from upmovies.news.source_quality import (
    best_tier,
    domain_for_story,
    downgrade_confidence,
    effective_tier,
    get_source_domains,
)
```

Change the `apply_cluster_decisions` signature to accept `unresolved_tier`:

```python
async def apply_cluster_decisions(
    session: AsyncSession,
    *,
    plan: ClusterPlan,
    raw: str,
    unresolved_tier: str = "acceptable",
) -> ClusterResult:
```

After `by_id = {s.id: s for s in stories}` (the line that builds the story map), add the per-story tier lookup:

```python
    # Source-quality tiers for the stories in this plan (NEU-454). One query; the gate reads
    # `resolved_url or url` and skips unresolved Google redirects (neutral default).
    domain_by_sid = {
        s.id: domain_for_story(url=s.url, resolved_url=s.resolved_url) for s in stories
    }
    tier_rows = await get_source_domains(session, [d for d in domain_by_sid.values() if d])

    def _tier_for(sid: UUID) -> str:
        domain = domain_by_sid.get(sid)
        row = tier_rows.get(domain) if domain else None
        return effective_tier(
            llm_tier=row.llm_tier if row else None,
            admin_override=row.admin_override if row else "none",
            unresolved_default=unresolved_tier,
        )
```

Then in the new-event branch, after the `is_stale_stage(...)` block and before `occurred = min(...)`, downgrade `conf`:

```python
            conf = downgrade_confidence(
                conf, best_tier((_tier_for(sid) for sid in group_sids), default=unresolved_tier)
            )
```

(`conf` is then used in `Event(confidence=conf, ...)` immediately below — no other change needed.)

- [ ] **Step 4: Thread `unresolved_tier` through `cluster_film_events`**

Still in `cluster.py`, update `cluster_film_events` to accept and forward it:

```python
async def cluster_film_events(
    session: AsyncSession,
    *,
    client: Completer,
    model: str,
    film_id: UUID,
    attach_limit: int,
    max_tokens: int = _DEFAULT_MAX_TOKENS,
    unresolved_tier: str = "acceptable",
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
    return await apply_cluster_decisions(
        session, plan=plan, raw=raw, unresolved_tier=unresolved_tier
    ), usage
```

- [ ] **Step 5: Thread `unresolved_tier` through the pipeline cluster stages**

In `src/upmovies/link/pipeline.py`, add `unresolved_tier: str` as a keyword arg to both `_cluster_stage_sequential` and `_cluster_stage_batched`.

In `_cluster_stage_sequential`, forward it into the `cluster_film_events(...)` call:

```python
                cluster, usage = await cluster_film_events(
                    s,
                    client=client,
                    model=model,
                    film_id=film_id,
                    attach_limit=attach_limit,
                    max_tokens=cluster_max_tokens,
                    unresolved_tier=unresolved_tier,
                )
```

In `_cluster_stage_batched`, forward it into the `apply_cluster_decisions(...)` call:

```python
                applied = await apply_cluster_decisions(
                    s, plan=plan, raw=result.text, unresolved_tier=unresolved_tier
                )
```

At the `cluster_stage(...)` call site inside `run_link_ingest` (currently passing `session_factory=…, cluster_max_tokens=…`), add:

```python
        unresolved_tier=unresolved_tier,
```

and add `unresolved_tier: str = "acceptable"` to `run_link_ingest`'s signature (keyword arg, near `cluster_max_tokens`). It will be supplied by config in Task 7; the default keeps existing callers/tests working.

- [ ] **Step 6: Run the test to verify it passes**

Run: `task test -- tests/integration/link/test_cluster_source_gate.py`
Expected: PASS (3 tests).

- [ ] **Step 7: Run the existing cluster tests (no regressions)**

Run: `task test -- tests/unit/link tests/integration/link`
Expected: PASS (existing cluster/pipeline tests still green — `unresolved_tier` defaults preserve behavior; unknown domains → neutral default → confidence unchanged).

- [ ] **Step 8: Lint, format, typecheck**

Run: `task format && task lint && task typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/upmovies/link/cluster.py src/upmovies/link/pipeline.py tests/integration/link/test_cluster_source_gate.py
git commit -m "feat: downgrade low-trust-only events to rumored at clustering"
```

---

### Task 6: SOURCE-JUDGE sub-stage (resolve → judge → hard-drop)

**Files:**
- Create: `src/upmovies/link/source_stage.py`
- Test: `tests/integration/link/test_source_stage.py`

**Interfaces:**
- Consumes: `Story` model; `resolve_google_news_url`, `is_google_news_url` (`news.resolve`); `domain_for_story`, `effective_tier`, `get_source_domains`, `judge_domains`, `upsert_judgements` (Tasks 1/3/4); `Completer`, `Usage`.
- Produces:
  - `SourceQualityResult` dataclass: `resolved: int`, `judged: int`, `blocked: int`
  - `run_source_quality_stage(*, session_factory, client, judge_model, resolver=resolve_google_news_url, unresolved_tier="acceptable") -> tuple[SourceQualityResult, Usage]`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/link/test_source_stage.py`:

```python
from datetime import UTC, datetime

from sqlalchemy import select

from upmovies.catalog.models import Film
from upmovies.link.source_stage import run_source_quality_stage
from upmovies.llm.client import Usage
from upmovies.news.models import SourceDomain, Story


class _FakeClient:
    def __init__(self, text):
        self._text = text
        self.calls = 0

    async def complete_with_usage(self, *, model, system, messages, max_tokens=...):
        self.calls += 1
        return self._text, Usage(input_tokens=1, output_tokens=1)


async def _film(session, slug):
    film = Film(tmdb_id=abs(hash(slug)) % 10_000_000, slug=slug, title="F")
    session.add(film)
    await session.flush()
    return film


async def _linked_story(session, film_id, url):
    s = Story(source="x", url=url, title="t", film_id=film_id, link_status="linked",
              fetched_at=datetime.now(UTC))
    session.add(s)
    await session.flush()
    return s


async def test_judges_unknown_domains_and_blocks(session_factory, session):
    film = await _film(session, "ss1")
    s_low = await _linked_story(session, film.id, "https://mshale.com/a")
    s_ok = await _linked_story(session, film.id, "https://variety.com/b")
    # Pre-block a domain via admin override so the story is hard-dropped.
    now = datetime.now(UTC)
    session.add(SourceDomain(domain="variety.com", admin_override="block",
                             first_seen_at=now, updated_at=now))
    await session.commit()

    client = _FakeClient('[{"domain": "mshale.com", "tier": "low", "reason": "farm"}]')

    async def _resolver(c, url):
        return None  # no Google URLs here

    result, usage = await run_source_quality_stage(
        session_factory=session_factory, client=client, judge_model="m", resolver=_resolver
    )

    assert result.judged == 1  # only mshale.com was unknown (variety.com pre-existed)
    assert result.blocked == 1  # variety.com story hard-dropped
    row = (await session.execute(select(Story).where(Story.id == s_ok.id))).scalar_one()
    assert row.link_status == "rejected" and row.link_note == "source-blocked"
    kept = (await session.execute(select(Story).where(Story.id == s_low.id))).scalar_one()
    assert kept.link_status == "linked"
    judged = (await session.execute(select(SourceDomain).where(SourceDomain.domain == "mshale.com"))).scalar_one()
    assert judged.llm_tier == "low"


async def test_resolves_google_urls_before_judging(session_factory, session):
    film = await _film(session, "ss2")
    s = await _linked_story(session, film.id, "https://news.google.com/rss/articles/ABC")
    await session.commit()

    client = _FakeClient('[{"domain": "deadline.com", "tier": "trusted", "reason": "trade"}]')

    async def _resolver(c, url):
        return "https://deadline.com/real-story"

    result, usage = await run_source_quality_stage(
        session_factory=session_factory, client=client, judge_model="m", resolver=_resolver
    )
    assert result.resolved == 1
    row = (await session.execute(select(Story).where(Story.id == s.id))).scalar_one()
    assert row.resolved_url == "https://deadline.com/real-story"
    assert row.resolve_state == "resolved"
    judged = (await session.execute(select(SourceDomain).where(SourceDomain.domain == "deadline.com"))).scalar_one()
    assert judged.llm_tier == "trusted"


async def test_empty_when_nothing_linked(session_factory):
    client = _FakeClient("[]")

    async def _resolver(c, url):
        return None

    result, usage = await run_source_quality_stage(
        session_factory=session_factory, client=client, judge_model="m", resolver=_resolver
    )
    assert result == type(result)(resolved=0, judged=0, blocked=0)
    assert client.calls == 0
```

> The `session_factory` fixture: if not already present in `tests/conftest.py` or a fixtures module, add one that yields a factory bound to the test engine. Check first — a factory fixture likely already exists for the pipeline integration tests (`tests/integration/link/test_pipeline.py` uses one). Reuse that fixture name; if it differs, rename the parameter here to match.

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/integration/link/test_source_stage.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'upmovies.link.source_stage'`.

- [ ] **Step 3: Implement the sub-stage**

Create `src/upmovies/link/source_stage.py`:

```python
"""SOURCE-JUDGE sub-stage (NEU-454): runs after LINK and before CLUSTER over the linked,
still-unclustered stories. Resolves Google-News URLs so we know the real publisher domain,
judges any unknown domains (cached judge-once), and hard-drops stories whose effective tier
is admin-blocked so they never form or join an event. Owns its own sessions and commits per
step so one failure never rolls back the rest — mirrors synthesize/url_resolution.py."""

import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx
from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from upmovies.link.linker import Completer
from upmovies.llm.client import Usage
from upmovies.news.models import EventStory, Story
from upmovies.news.resolve import is_google_news_url, resolve_google_news_url
from upmovies.news.source_quality import (
    domain_for_story,
    effective_tier,
    get_source_domains,
    judge_domains,
    upsert_judgements,
)

log = logging.getLogger(__name__)

SessionFactory = Callable[[], AsyncSession]
Resolver = Callable[[httpx.AsyncClient, str], Awaitable[str | None]]


@dataclass
class SourceQualityResult:
    resolved: int
    judged: int
    blocked: int


@asynccontextmanager
async def _owned_session(session_factory: SessionFactory) -> AsyncIterator[AsyncSession]:
    async with session_factory() as s:
        yield s


async def _linked_unclustered(session: AsyncSession) -> list[Story]:
    clustered = exists().where(EventStory.story_id == Story.id)
    return list(
        (
            await session.execute(
                select(Story).where(
                    Story.link_status == "linked",
                    Story.film_id.is_not(None),
                    ~clustered,
                )
            )
        )
        .scalars()
        .all()
    )


async def run_source_quality_stage(
    *,
    session_factory: SessionFactory,
    client: Completer,
    judge_model: str,
    resolver: Resolver = resolve_google_news_url,
    unresolved_tier: str = "acceptable",
) -> tuple[SourceQualityResult, Usage]:
    # 1. Resolve Google-News URLs for the linked batch so we know the publisher domain.
    async with _owned_session(session_factory) as s:
        stories = await _linked_unclustered(s)
        pending = [
            (st.id, st.url)
            for st in stories
            if st.resolved_url is None and is_google_news_url(st.url)
        ]

    resolved = 0
    if pending:
        async with httpx.AsyncClient() as http:
            for story_id, url in pending:
                real: str | None = None
                try:
                    real = await resolver(http, url)
                except Exception:
                    log.exception("source-stage: resolve crashed for story %s", story_id)
                async with _owned_session(session_factory) as s:
                    story = await s.get(Story, story_id)
                    if story is None:
                        continue
                    story.resolve_attempts += 1
                    if real:
                        story.resolved_url = real
                        story.resolve_state = "resolved"
                        resolved += 1
                    else:
                        story.resolve_state = "failed"
                    await s.commit()

    # 2. Re-read the batch (now with resolved_urls), compute domains, judge unknowns.
    async with _owned_session(session_factory) as s:
        stories = await _linked_unclustered(s)
        domain_by_sid = {
            st.id: domain_for_story(url=st.url, resolved_url=st.resolved_url) for st in stories
        }
        sample_by_domain: dict[str, str] = {}
        for st in stories:
            d = domain_by_sid[st.id]
            if d and d not in sample_by_domain:
                sample_by_domain[d] = st.title
        all_domains = set(sample_by_domain)
        known = await get_source_domains(s, all_domains)
        unknown = sorted(all_domains - set(known))

    usage = Usage()
    judged = 0
    if unknown:
        items = [{"domain": d, "sample_headline": sample_by_domain[d]} for d in unknown]
        verdicts, usage = await judge_domains(client=client, model=judge_model, items=items)
        async with _owned_session(session_factory) as s:
            judged = await upsert_judgements(
                s, verdicts, model=judge_model, now=datetime.now(UTC)
            )
            await s.commit()

    # 3. Hard-drop stories whose effective tier is admin-blocked.
    blocked = 0
    async with _owned_session(session_factory) as s:
        stories = await _linked_unclustered(s)
        domain_by_sid = {
            st.id: domain_for_story(url=st.url, resolved_url=st.resolved_url) for st in stories
        }
        rows = await get_source_domains(s, [d for d in domain_by_sid.values() if d])
        now = datetime.now(UTC)
        for st in stories:
            domain = domain_by_sid.get(st.id)
            row = rows.get(domain) if domain else None
            tier = effective_tier(
                llm_tier=row.llm_tier if row else None,
                admin_override=row.admin_override if row else "none",
                unresolved_default=unresolved_tier,
            )
            if tier == "blocked":
                st.link_status = "rejected"
                st.film_id = None
                st.link_confidence = None
                st.link_note = "source-blocked"
                st.linked_at = now
                blocked += 1
        await s.commit()

    return SourceQualityResult(resolved=resolved, judged=judged, blocked=blocked), usage
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `task test -- tests/integration/link/test_source_stage.py`
Expected: PASS (3 tests).

- [ ] **Step 5: Lint, format, typecheck**

Run: `task format && task lint && task typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/upmovies/link/source_stage.py tests/integration/link/test_source_stage.py
git commit -m "feat: add SOURCE-JUDGE sub-stage (resolve, judge, hard-drop)"
```

---

### Task 7: Wire the sub-stage into `run_link_ingest` + config

**Files:**
- Modify: `src/upmovies/config.py`
- Modify: `src/upmovies/link/pipeline.py`
- Modify: `src/upmovies/routers/ingest_admin.py`
- Test: `tests/integration/link/test_pipeline_source_gate.py`

**Interfaces:**
- Consumes: `run_source_quality_stage` (Task 6); `record_llm_usage`.
- Produces: `run_link_ingest(..., source_gate_enabled: bool = False, source_judge_model: str = "claude-haiku-4-5", unresolved_tier: str = "acceptable")` runs the sub-stage between LINK and CLUSTER when enabled.
- Config: `source_gate_enabled`, `source_judge_model`, `source_unresolved_tier`.

- [ ] **Step 1: Add config settings**

In `src/upmovies/config.py`, after the `link_cluster_attach_limit` line, add:

```python
    source_gate_enabled: bool = Field(default=True, alias="SOURCE_GATE_ENABLED")
    source_judge_model: str = Field(default="claude-haiku-4-5", alias="SOURCE_JUDGE_MODEL")
    source_unresolved_tier: str = Field(default="acceptable", alias="SOURCE_UNRESOLVED_TIER")
```

- [ ] **Step 2: Write the failing test**

Create `tests/integration/link/test_pipeline_source_gate.py`:

```python
from datetime import UTC, datetime

from sqlalchemy import select

from upmovies.catalog.models import Film
from upmovies.link.pipeline import run_link_ingest
from upmovies.llm.client import Usage
from upmovies.news.models import Event, SourceDomain, Story


class _StubClient:
    """LinkClient stub: linking is skipped (no pending stories), cluster returns one event."""

    async def complete_with_usage(self, *, model, system, messages, max_tokens=...):
        # Domain judge for unknown domains -> mshale.com low.
        if "source-quality rater" in system[0]["text"]:
            return '[{"domain": "mshale.com", "tier": "low", "reason": "farm"}]', Usage()
        # Cluster call -> one confirmed casting event over story n=1.
        return '{"events": [{"existing": null, "type": "casting", "confidence": "confirmed", "stories": [1]}]}', Usage()

    async def complete_batch(self, requests, *, poll_interval=..., timeout=...):
        return {}


async def test_pipeline_gate_downgrades_low_trust(session_factory, session):
    film = Film(tmdb_id=555, slug="pipe-gate", title="Gate Film")
    session.add(film)
    await session.flush()
    story = Story(source="x", url="https://mshale.com/a", title="Big casting", film_id=film.id,
                  link_status="linked", fetched_at=datetime.now(UTC))
    session.add(story)
    await session.commit()

    async def _resolver(c, url):
        return None

    # Patch the resolver used by the stage via the source_gate_enabled path.
    from upmovies.link import source_stage
    orig = source_stage.resolve_google_news_url
    source_stage.resolve_google_news_url = _resolver
    try:
        # run_id: create a run row first (mirror other pipeline tests' helper if present).
        from upmovies.ingest.runs import create_run
        run_id = await create_run(session, kind="link")
        await session.commit()
        await run_link_ingest(
            session_factory=session_factory,
            client=_StubClient(),
            run_id=run_id,
            model="m",
            cluster_model="m",
            recency_days=30,
            batch_size=10,
            floor=0.7,
            source_gate_enabled=True,
            source_judge_model="m",
            unresolved_tier="acceptable",
        )
    finally:
        source_stage.resolve_google_news_url = orig

    event = (await session.execute(select(Event).where(Event.film_id == film.id))).scalar_one()
    assert event.confidence == "rumored"
    judged = (await session.execute(select(SourceDomain).where(SourceDomain.domain == "mshale.com"))).scalar_one()
    assert judged.llm_tier == "low"
```

> If a `run_id`/`create_run` helper fixture already exists in the link integration tests, use it instead of the inline `create_run` call. Match the `session_factory` fixture name used by `test_pipeline.py`.

- [ ] **Step 3: Run the test to verify it fails**

Run: `task test -- tests/integration/link/test_pipeline_source_gate.py`
Expected: FAIL — `run_link_ingest()` got an unexpected keyword argument `source_gate_enabled`.

- [ ] **Step 4: Wire the sub-stage into `run_link_ingest`**

In `src/upmovies/link/pipeline.py`, add the import:

```python
from upmovies.link.source_stage import run_source_quality_stage
```

Add these keyword args to `run_link_ingest`'s signature (near `cluster_max_tokens`). Note `unresolved_tier` was already added in Task 5 Step 5 — do **not** add it again; only add these two:

```python
    source_gate_enabled: bool = False,
    source_judge_model: str = "claude-haiku-4-5",
```

Between the LINK usage-recording block (ends ~line 309, `await s.commit()`) and the `# --- Stage 2` comment, insert:

```python
    # --- Source-quality sub-stage: resolve domains, judge unknowns, drop admin-blocked ---
    if source_gate_enabled:
        source_result, source_usage = await run_source_quality_stage(
            session_factory=session_factory,
            client=client,
            judge_model=source_judge_model,
            unresolved_tier=unresolved_tier,
        )
        async with _owned_session(session_factory) as s:
            await record_llm_usage(
                s,
                run_id,
                stage="source_judge",
                model=source_judge_model,
                batched=False,
                usage=source_usage,
            )
            await s.commit()
        log.info(
            "source-gate: resolved %d, judged %d, blocked %d",
            source_result.resolved,
            source_result.judged,
            source_result.blocked,
        )
```

(The `unresolved_tier` arg is already forwarded to `cluster_stage(...)` from Task 5, Step 5.)

- [ ] **Step 5: Wire config into the trigger**

In `src/upmovies/routers/ingest_admin.py`, inside `_background_link`'s `run_link_ingest(...)` call, add:

```python
                source_gate_enabled=settings.source_gate_enabled,
                source_judge_model=settings.source_judge_model,
                unresolved_tier=settings.source_unresolved_tier,
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `task test -- tests/integration/link/test_pipeline_source_gate.py`
Expected: PASS.

- [ ] **Step 7: Run the full link suite (no regressions)**

Run: `task test -- tests/integration/link tests/unit/link`
Expected: PASS (the gate is off by default in `run_link_ingest`, so existing pipeline tests are unchanged).

- [ ] **Step 8: Lint, format, typecheck**

Run: `task format && task lint && task typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/upmovies/config.py src/upmovies/link/pipeline.py src/upmovies/routers/ingest_admin.py tests/integration/link/test_pipeline_source_gate.py
git commit -m "feat: run source-quality sub-stage in link pipeline (Refs NEU-454.)"
```

---

### Task 8: Admin endpoints for source domains

**Files:**
- Create: `src/upmovies/routers/sources_admin.py`
- Modify: `src/upmovies/main.py`
- Test: `tests/integration/routers/test_sources_admin.py`

**Interfaces:**
- Consumes: `list_source_domains`, `set_override` (Task 3); `VALID_OVERRIDES` (Task 1); `require_current_admin`, `require_csrf`, `get_session`.
- Produces: `GET /admin/sources`, `POST /admin/sources/{domain}/override`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/routers/test_sources_admin.py`:

```python
from datetime import UTC, datetime

from upmovies.news.models import SourceDomain


async def _seed(session, domain, tier):
    now = datetime.now(UTC)
    session.add(SourceDomain(domain=domain, llm_tier=tier, llm_reason="r", admin_override="none",
                             first_seen_at=now, judged_at=now, updated_at=now))
    await session.commit()


async def test_list_requires_auth(client):
    r = await client.get("/admin/sources")
    assert r.status_code == 401


async def test_list_forbidden_for_non_admin(authed_client):
    r = await authed_client.get("/admin/sources")
    assert r.status_code == 403


async def test_list_returns_domains(admin_authed_client, session):
    await _seed(session, "mshale.com", "low")
    r = await admin_authed_client.get("/admin/sources")
    assert r.status_code == 200
    body = r.json()
    assert any(d["domain"] == "mshale.com" and d["llm_tier"] == "low" for d in body)


async def test_set_override_roundtrip(admin_authed_client, session):
    await _seed(session, "mshale.com", "low")
    r = await admin_authed_client.post("/admin/sources/mshale.com/override", json={"override": "block"})
    assert r.status_code == 200
    assert r.json()["admin_override"] == "block"
    row = await session.get(SourceDomain, "mshale.com", populate_existing=True)
    assert row.admin_override == "block"


async def test_set_override_rejects_bad_value(admin_authed_client):
    r = await admin_authed_client.post("/admin/sources/x.com/override", json={"override": "banish"})
    assert r.status_code == 422


async def test_set_override_creates_unseen_domain(admin_authed_client, session):
    r = await admin_authed_client.post("/admin/sources/newsite.test/override", json={"override": "trust"})
    assert r.status_code == 200
    row = await session.get(SourceDomain, "newsite.test", populate_existing=True)
    assert row is not None and row.admin_override == "trust"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `task test -- tests/integration/routers/test_sources_admin.py`
Expected: FAIL — 404s (router not registered).

- [ ] **Step 3: Create the router**

Create `src/upmovies/routers/sources_admin.py`:

```python
"""Session + is_admin + CSRF protected endpoints for viewing source-domain trust tiers and
setting per-domain admin overrides (the backend for NEU-456's admin Sources page). Distinct
from the ADMIN_TOKEN machine endpoints."""

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from upmovies.deps import get_session, require_csrf, require_current_admin
from upmovies.news import source_quality

router = APIRouter(
    prefix="/admin/sources",
    tags=["admin"],
    dependencies=[Depends(require_current_admin), Depends(require_csrf)],
)


class SourceDomainOut(BaseModel):
    domain: str
    llm_tier: str | None
    llm_reason: str | None
    admin_override: str
    updated_at: datetime


class OverrideBody(BaseModel):
    override: Literal["none", "block", "allow", "trust"]


def _to_out(row: source_quality.SourceDomain) -> SourceDomainOut:
    return SourceDomainOut(
        domain=row.domain,
        llm_tier=row.llm_tier,
        llm_reason=row.llm_reason,
        admin_override=row.admin_override,
        updated_at=row.updated_at,
    )


@router.get("", response_model=list[SourceDomainOut])
async def list_sources(db: AsyncSession = Depends(get_session)) -> list[SourceDomainOut]:
    rows = await source_quality.list_source_domains(db)
    return [_to_out(r) for r in rows]


@router.post("/{domain}/override", response_model=SourceDomainOut)
async def set_source_override(
    domain: str, body: OverrideBody, db: AsyncSession = Depends(get_session)
) -> SourceDomainOut:
    row = await source_quality.set_override(
        db, domain=domain, override=body.override, now=datetime.now(UTC)
    )
    await db.commit()
    return _to_out(row)
```

> `OverrideBody`'s `Literal[...]` gives a 422 automatically for invalid override values (Task 8, Step 1's `test_set_override_rejects_bad_value`). `SourceDomain` is re-exported from `source_quality`'s imports; if pyright flags `source_quality.SourceDomain`, import it directly from `upmovies.news.models` instead.

- [ ] **Step 4: Register the router**

In `src/upmovies/main.py`, add `sources_admin` to the `from upmovies.routers import (...)` block and add the include line after `moderation_admin`:

```python
    app.include_router(sources_admin.router)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `task test -- tests/integration/routers/test_sources_admin.py`
Expected: PASS (6 tests).

- [ ] **Step 6: Lint, format, typecheck**

Run: `task format && task lint && task typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/upmovies/routers/sources_admin.py src/upmovies/main.py tests/integration/routers/test_sources_admin.py
git commit -m "feat: add admin endpoints for source-domain overrides"
```

---

## Final verification (before PR)

- [ ] **Full CI locally:** `task format && task lint && task typecheck && task test`
- [ ] **Migration head is single & applies clean:** `task migrate` (idempotent), and confirm `alembic heads` reports one head. (Run inside the container: `task shell` → `alembic heads`.)
- [ ] **Manual smoke (optional):** trigger `/admin/ingest/link` against seeded data and confirm a low-trust-only event lands as `rumored` and an admin-blocked domain's stories are `rejected` with `link_note='source-blocked'`.
- [ ] Open the PR: title `feat: source-quality gate for low-trust news domains (NEU-454)`; body includes the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` footer.

## Self-Review notes (coverage against the spec)

- **`source_domain` table** → Task 2. **Effective-tier precedence** → Task 1 (`effective_tier`) + Task 3 (`set_override`). **LLM-judge, unknown-only, cached** → Task 4 (`judge_domains`) + Task 6 (only `unknown` judged; `upsert_judgements` skips existing). **Domain derivation, approach B, front-loads resolution** → Task 6 (`run_source_quality_stage`). **`tldextract` registrable domain** → Task 1. **Unresolvable-Google → neutral default** → Task 1 (`domain_for_story` returns None) + config `source_unresolved_tier` (Task 7). **Hard-drop admin-blocked** → Task 6. **Confidence override (all-low → rumored, rule (i))** → Task 5. **Admin read/write endpoints** → Task 8. **Tests, LLM mocked, full local CI** → every task + Final verification.
- **Out of scope confirmed absent:** no NEU-456 frontend, no corroboration threshold, no historical backfill, no change to TMDB-derived production status.
