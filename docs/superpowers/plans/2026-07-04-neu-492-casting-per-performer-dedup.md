# NEU-492 — Per-performer casting dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop duplicate casting events deterministically: a casting story creates a new event only for the performers it introduces that aren't already recorded for the film, scoped to just those names; a story that names no new performer drops.

**Architecture:** The model extracts performer names (`cast`) per casting event; code owns the new-vs-recorded decision. A new `Event.subject_key` (normalized names) persists what each casting event represents, so a new story can be partitioned against the film's already-recorded performers inside `apply_cluster_decisions`. The summarizer is scoped by `subject_key` so a blurb names only the new performer. All new-vs-old logic is deterministic Python; the LLM only extracts names.

**Tech Stack:** Python 3.13, SQLAlchemy 2 (async) + asyncpg, PostgreSQL, Alembic, Anthropic Sonnet (clusterer) / Haiku (summarizer), pytest + pytest-asyncio (auto mode).

## Global Constraints

- **Everything runs in Docker via `task`.** Never run `pytest`/`ruff`/`pyright`/`alembic`/`python` on the host. Use `task test`, `task lint`, `task typecheck`, `task format`, `task makemigration`, `task migrate`. Container must be up (`task up`).
- **Type hints:** modern `X | None` / `X | Y`. **No** `from __future__ import annotations`.
- **Lint:** ruff, line length 100.
- **TDD:** failing test first; pytest-asyncio `auto` (no decorator). Cluster/summarizer are unit-testable with fakes (`FakeClient` / injected `Completer`); DB tests use the `session` fixture.
- **Integration-test isolation quirk:** never run a single integration file alone — scope to the directory: `task test -- tests/integration/link/`.
- **Casting key = normalized name** (not TMDB person id). Normalization: `unicodedata.normalize("NFKC", …).casefold().strip()` then collapse internal whitespace.
- **Commits:** implementer tasks do **NOT** commit — the human commits the whole NEU-492 change once at the end (see Wrap-up) after `task format`. Branch: `tom/neu-492-deterministic-per-performer-casting-dedup-linkcluster`.

---

### Task 1: `Event.subject_key` column + `_normalize_name` helper

**Files:**
- Modify: `src/upmovies/news/models.py` (add `subject_key` to `Event`; ensure `ARRAY` imported)
- Modify: `src/upmovies/link/cluster.py` (add `import unicodedata`; add `_normalize_name`)
- Test: `tests/unit/link/test_cluster_pure.py` (append `_normalize_name` cases)

**Interfaces:**
- Produces:
  - `Event.subject_key: list[str] | None` (Postgres `text[]`, nullable) — normalized performer names a casting event represents; null for non-casting events.
  - `def _normalize_name(name: str) -> str` in `cluster.py`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/link/test_cluster_pure.py`:

```python
def test_normalize_name_folds_case_and_whitespace():
    from upmovies.link.cluster import _normalize_name

    assert _normalize_name("Alain  Chabat") == "alain chabat"
    assert _normalize_name("  Monica Barbaro ") == "monica barbaro"
    assert _normalize_name("JOHN DOE") == "john doe"
    assert _normalize_name("") == ""
```

- [ ] **Step 2: Run test to verify it fails**

Run: `task test -- tests/unit/link/test_cluster_pure.py`
Expected: FAIL — `ImportError: cannot import name '_normalize_name'`.

- [ ] **Step 3: Add `_normalize_name`**

In `src/upmovies/link/cluster.py`, add `import unicodedata` to the imports and add near the top-level helpers (e.g., after `is_stale_stage`):

```python
def _normalize_name(name: str) -> str:
    """Deterministic casting-identity key: NFKC-fold, casefold, collapse whitespace.
    String-based (not TMDB-person-id) — imperfect on aliases/typos, but stable and
    dependency-free, which fits breaking-cast news where TMDB credits lag."""
    folded = unicodedata.normalize("NFKC", name).casefold().strip()
    return " ".join(folded.split())
```

- [ ] **Step 4: Add the `subject_key` column**

In `src/upmovies/news/models.py`, ensure the postgresql import includes `ARRAY`:

```python
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
```

Add to the `Event` class (after `region`):

```python
    subject_key: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `task test -- tests/unit/link/test_cluster_pure.py`
Expected: PASS.

- [ ] **Step 6: Lint + typecheck**

Run: `task format && task lint && task typecheck`
Expected: no errors.

---

### Task 2: `cast` in the cluster contract (extraction)

**Files:**
- Modify: `src/upmovies/link/cluster.py` (`ClusterGroup`, `parse_cluster_groups`, `_INSTRUCTIONS`)
- Test: `tests/unit/link/test_cluster_pure.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ClusterGroup.cast: list[str] | None` — raw performer names the model reports for a casting event (unnormalized; normalization happens in Task 3).

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/link/test_cluster_pure.py`:

```python
def test_parse_reads_cast_for_casting_events():
    from upmovies.link.cluster import parse_cluster_groups

    raw = (
        '{"events": [{"existing": null, "type": "casting", "confidence": "confirmed", '
        '"cast": ["Monica Barbaro", "John Doe"], "stories": [1]}]}'
    )
    groups = parse_cluster_groups(raw, n_stories=1)
    assert groups is not None and len(groups) == 1
    assert groups[0].cast == ["Monica Barbaro", "John Doe"]


def test_parse_cast_absent_is_none():
    from upmovies.link.cluster import parse_cluster_groups

    raw = '{"events": [{"existing": null, "type": "trailer", "confidence": "confirmed", "stories": [1]}]}'
    groups = parse_cluster_groups(raw, n_stories=1)
    assert groups is not None and groups[0].cast is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `task test -- tests/unit/link/test_cluster_pure.py`
Expected: FAIL — `AttributeError: 'ClusterGroup' object has no attribute 'cast'`.

- [ ] **Step 3: Add `cast` to `ClusterGroup`**

In `src/upmovies/link/cluster.py`, add the field to the dataclass:

```python
@dataclass
class ClusterGroup:
    existing: int | None
    event_type: str | None
    confidence: str | None
    story_indices: list[int]
    region: str | None = None
    cast: list[str] | None = None
```

- [ ] **Step 4: Parse `cast` in `parse_cluster_groups`**

In `parse_cluster_groups`, inside the `for group in data.get("events", []):` loop, before constructing the `ClusterGroup`, add:

```python
        cast_raw = group.get("cast")
        cast = (
            [c for c in cast_raw if isinstance(c, str) and c.strip()]
            if isinstance(cast_raw, list)
            else None
        )
```

and pass `cast=cast` to the `ClusterGroup(...)` constructor.

- [ ] **Step 5: Update the prompt contract**

In `_INSTRUCTIONS`, add `"cast"` to the return-JSON block. Replace the JSON schema line:

```python
{"events": [{"existing": <existing event number or null>, "type": <type or null>, \
"confidence": "confirmed" | "rumored" | null, "region": <ISO 3166-1 alpha-2 or null>, \
"cast": [<performer name>, ...] for a casting event, else null, \
"stories": [<story number n>, ...]}]}
```

And add one line to the casting definition (right after the "A 'casting' event requires an actual performer's name" bullet):

```
- For a "casting" event, list in "cast" the exact performer name(s) the story reports as \
joining THIS film — the people actually cast, not the director or characters.
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `task test -- tests/unit/link/test_cluster_pure.py`
Expected: PASS.

- [ ] **Step 7: Lint + typecheck**

Run: `task format && task lint && task typecheck`
Expected: no errors.

---

### Task 3: Deterministic casting routing in `apply_cluster_decisions`

**Files:**
- Modify: `src/upmovies/link/cluster.py` (`apply_cluster_decisions` + a `_recorded_cast_names` helper)
- Test: `tests/integration/link/test_cluster.py`

**Interfaces:**
- Consumes: `_normalize_name` (Task 1), `ClusterGroup.cast` (Task 2), `Event.subject_key` (Task 1).
- Produces: casting events with `subject_key` set to the newly-introduced performers; stories whose casting names nothing new get `link_status="rejected"`, `link_note="casting-recorded"`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/link/test_cluster.py` (imports `Film`, `Event`, `EventStory`, `Story`, `apply_cluster_decisions`/`cluster_film_events`, `FakeClient`, `_linked_story` already exist in this file):

```python
async def _casting_event(session, film, names, *, url):
    story = await _linked_story(session, film, url, title="prior casting")
    event = Event(
        film_id=film.id,
        event_type="casting",
        confidence="confirmed",
        occurred_at=datetime.now(UTC),
        subject_key=names,
    )
    session.add(event)
    await session.flush()
    session.add(EventStory(event_id=event.id, story_id=story.id))
    return event


async def test_casting_new_performer_creates_scoped_event(session):
    film = Film(tmdb_id=1, title="Oceans")
    session.add(film)
    await session.flush()
    await _casting_event(session, film, ["monica barbaro"], url="https://e/prior")
    await _linked_story(session, film, "https://e/new", title="Monica + John cast")
    await session.commit()

    client = FakeClient(
        {"events": [{"existing": None, "type": "casting", "confidence": "confirmed",
                     "cast": ["Monica Barbaro", "John Doe"], "stories": [1]}]}
    )
    result, _ = await cluster_film_events(
        session, client=client, model="m", film_id=film.id, attach_limit=45,
        run_date=date(2026, 1, 1),
    )
    await session.commit()

    assert result.events_created == 1
    events = (await session.execute(
        select(Event).where(Event.film_id == film.id, Event.event_type == "casting")
    )).scalars().all()
    keys = sorted((e.subject_key or []) for e in events)
    assert keys == [["john doe"], ["monica barbaro"]]  # original untouched, new scoped to John


async def test_casting_no_new_performer_drops(session):
    film = Film(tmdb_id=1, title="Oceans")
    session.add(film)
    await session.flush()
    await _casting_event(session, film, ["monica barbaro"], url="https://e/prior")
    await _linked_story(session, film, "https://e/new", title="Monica restated")
    await session.commit()

    client = FakeClient(
        {"events": [{"existing": None, "type": "casting", "confidence": "confirmed",
                     "cast": ["Monica Barbaro"], "stories": [1]}]}
    )
    result, _ = await cluster_film_events(
        session, client=client, model="m", film_id=film.id, attach_limit=45,
        run_date=date(2026, 1, 1),
    )
    await session.commit()

    assert result.events_created == 0
    assert result.stories_rejected == 1
    story = (await session.execute(
        select(Story).where(Story.url == "https://e/new")
    )).scalar_one()
    assert story.link_status == "rejected"
    assert story.link_note == "casting-recorded"


async def test_casting_in_pass_dedup(session):
    film = Film(tmdb_id=1, title="Oceans")
    session.add(film)
    await session.flush()
    await _linked_story(session, film, "https://e/a", title="John cast (outlet A)")
    await _linked_story(session, film, "https://e/b", title="John cast (outlet B)")
    await session.commit()

    client = FakeClient(
        {"events": [
            {"existing": None, "type": "casting", "confidence": "confirmed",
             "cast": ["John Doe"], "stories": [1]},
            {"existing": None, "type": "casting", "confidence": "confirmed",
             "cast": ["John Doe"], "stories": [2]},
        ]}
    )
    result, _ = await cluster_film_events(
        session, client=client, model="m", film_id=film.id, attach_limit=45,
        run_date=date(2026, 1, 1),
    )
    await session.commit()

    assert result.events_created == 1  # second John group is a same-pass duplicate → dropped
    assert result.stories_rejected == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `task test -- tests/integration/link/`
Expected: FAIL — new casting stories currently create unscoped duplicate events (`subject_key` is `None`; no drop).

- [ ] **Step 3: Add the recorded-performer query helper**

In `src/upmovies/link/cluster.py`, add near `_load_events_in_order`:

```python
async def _recorded_cast_names(session: AsyncSession, film_id: UUID) -> set[str]:
    """All normalized performer names already represented by this film's casting events
    (dedicated query — not limited to the attach-window candidate set)."""
    rows = (
        await session.execute(
            select(Event.subject_key).where(
                Event.film_id == film_id,
                Event.event_type == "casting",
                Event.subject_key.isnot(None),
            )
        )
    ).scalars().all()
    names: set[str] = set()
    for key in rows:
        names.update(key or [])
    return names
```

- [ ] **Step 4: Wire the routing into `apply_cluster_decisions`**

In `apply_cluster_decisions`, after the `dedup_targets` build loop (right before `assigned: set[UUID] = set()`), add:

```python
    recorded_cast = await _recorded_cast_names(session, plan.film_id)
```

In the new-event branch, immediately **after** the `if is_stale_stage(...)` block and **before** the `target = dedup_targets.get(...)` line, add:

```python
            new_cast: list[str] | None = None
            if etype == "casting":
                names = list(
                    dict.fromkeys(
                        _normalize_name(c)
                        for c in (group.cast or [])
                        if isinstance(c, str) and _normalize_name(c)
                    )
                )
                new_cast = [n for n in names if n not in recorded_cast]
                if not new_cast:
                    for sid in group_sids:
                        story = by_id[sid]
                        story.link_status = "rejected"
                        story.film_id = None
                        story.link_confidence = None
                        story.link_note = "casting-recorded"
                        assigned.add(sid)
                        stories_rejected += 1
                    continue
```

In the `Event(...)` constructor (the `else` create branch), add the `subject_key` kwarg:

```python
                event = Event(
                    film_id=plan.film_id,
                    event_type=etype,
                    confidence=conf,
                    occurred_at=occurred,
                    region=group.region if etype == "release_date" else None,
                    subject_key=new_cast if etype == "casting" else None,
                )
```

And immediately after `if etype in _SINGULAR_BEAT_TYPES: dedup_targets[etype] = event`, add:

```python
                if etype == "casting" and new_cast:
                    recorded_cast.update(new_cast)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `task test -- tests/integration/link/`
Expected: PASS (the three new casting tests + existing cluster tests).

- [ ] **Step 6: Lint + typecheck**

Run: `task format && task lint && task typecheck`
Expected: no errors.

---

### Task 4: Scope casting summaries by `subject_key`

**Files:**
- Modify: `src/upmovies/synthesize/summarizer.py` (`EventInput`, `_event_payload`, `_INSTRUCTIONS`)
- Modify: `src/upmovies/synthesize/pipeline.py` (map `event.subject_key` → `EventInput.subjects`)
- Modify: `src/upmovies/config.py` (bump `summary_prompt_version` 8 → 9)
- Test: `tests/unit/synthesize/test_summarizer.py`, `tests/unit/test_config.py`

**Interfaces:**
- Consumes: `Event.subject_key` (Task 1).
- Produces: `EventInput.subjects: Sequence[str] | None` threaded into the summary payload as `subjects`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/synthesize/test_summarizer.py`:

```python
def test_event_payload_includes_subjects_when_present():
    from datetime import UTC, date, datetime

    from upmovies.synthesize.summarizer import EventInput, StoryInput, _event_payload

    event = EventInput(
        event_type="casting",
        film_title="Oceans",
        source_updated_at=datetime(2026, 1, 1, tzinfo=UTC),
        stories=[StoryInput(title="t", dek="d", source="s")],
        subjects=["john doe"],
    )
    payload = _event_payload(event, date(2026, 1, 1))
    assert payload["subjects"] == ["john doe"]


def test_instructions_scope_summary_to_subjects():
    from upmovies.synthesize.summarizer import _INSTRUCTIONS

    lowered = _INSTRUCTIONS.lower()
    assert "subjects" in lowered
    assert "name only them" in lowered
```

Update the version assertion in `tests/unit/test_config.py` (`test_settings_summary_defaults`):

```python
    assert s.summary_prompt_version == "9"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `task test -- tests/unit/synthesize/test_summarizer.py tests/unit/test_config.py`
Expected: FAIL — `EventInput` has no `subjects`; version still `"8"`.

- [ ] **Step 3: Add `subjects` to `EventInput` + payload**

In `src/upmovies/synthesize/summarizer.py`, add the field to the frozen dataclass:

```python
@dataclass(frozen=True)
class EventInput:
    event_type: str
    film_title: str
    source_updated_at: datetime
    stories: Sequence[StoryInput]
    subjects: Sequence[str] | None = None
```

In `_event_payload`, build the dict then conditionally add subjects:

```python
def _event_payload(event: EventInput, run_date: date) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "as_of_date": run_date.isoformat(),
        "film": event.film_title,
        "event_type": event.event_type,
        "stories": [
            {"title": s.title, "dek": s.dek[:_DEK_MAX], "source": s.source} for s in event.stories
        ],
    }
    if event.subjects:
        payload["subjects"] = list(event.subjects)
    return payload
```

- [ ] **Step 4: Add the scoping rule to `_INSTRUCTIONS`**

In `src/upmovies/synthesize/summarizer.py`, add a bullet right after the "Name only the people party to THIS beat" bullet:

```
- If the payload includes a "subjects" list, this beat concerns ONLY those named \
performers — name only them and ignore any other performers the stories mention.
```

- [ ] **Step 5: Map `subject_key` in the synthesize pipeline**

In `src/upmovies/synthesize/pipeline.py`, in `_select_pending`, the `EventInput(...)` construction (currently `event_type=…, film_title=…, source_updated_at=…, stories=story_inputs`) — add:

```python
                    subjects=event.subject_key,
```

(`event` is the ORM `Event`, which now carries `subject_key`.)

- [ ] **Step 6: Bump the summary prompt version**

In `src/upmovies/config.py`:

```python
    summary_prompt_version: str = Field(default="9", alias="SUMMARY_PROMPT_VERSION")
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `task test -- tests/unit/synthesize/ tests/unit/test_config.py`
Expected: PASS.

- [ ] **Step 8: Full suite + lint + typecheck**

Run: `task format && task lint && task typecheck && task test`
Expected: all green.

---

### Task 5: Alembic migration for `Event.subject_key`

**Files:**
- Create: `migrations/versions/<autogen>_add_event_subject_key.py`

- [ ] **Step 1: Autogenerate**

Run: `task makemigration -- "add event.subject_key"`
Expected: a migration whose `upgrade()` is `op.add_column('event', sa.Column('subject_key', postgresql.ARRAY(sa.Text()), nullable=True), schema='news')` and `downgrade()` is `op.drop_column('event', 'subject_key', schema='news')`. Confirm the generated file imports `from sqlalchemy.dialects import postgresql`.

- [ ] **Step 2: Apply + confirm single head**

Run: `task migrate`, then in `task shell`: `alembic heads` (expect one head), `alembic downgrade -1`, `alembic upgrade head` (round-trip clean).

---

## Wrap-up (human, once)

- [ ] Full local CI green: `task format && task lint && task typecheck && task test`; `alembic heads` shows one head.
- [ ] Commit on `tom/neu-492-deterministic-per-performer-casting-dedup-linkcluster` via `/commit-msg` (e.g. `feat(link): deterministic per-performer casting dedup`), no Linear ID in subject, no footer/Co-Authored-By. Pre-commit hooks run in Docker — commit normally.
- [ ] Open PR via `/pr-desc`; title `feat(link): deterministic per-performer casting dedup (NEU-492)`; `🤖 Generated with Claude Code` footer in the PR body only.

## Non-goals / follow-ups

- **`subject_key` backfill of pre-existing casting events is out of scope here.** It needs an LLM name-extraction pass over old events' stories — its own small ticket. Until done, the degradation is bounded and self-healing: a performer recorded only in a pre-feature (keyless) event may spawn **one** duplicate the next time they're in the news, after which they carry a key. New dupes among keyed events are caught immediately.
- No change to the model's own attach behavior (the `existing` branch) — the deterministic guard only intercepts the *new-event* casting path. Existing casting-consolidation prompt lines stay as belt-and-suspenders.

## Self-review notes (coverage vs. spec Part A)

- **A1 `cast` extraction** → Task 2. **A2 `subject_key` storage** → Task 1 + Task 5 migration. **A3 deterministic routing** → Task 3. **A4 summarizer scoping** → Task 4. **A5 backfill** → deferred follow-up (documented above).
- Type consistency: `_normalize_name(str) -> str`, `ClusterGroup.cast: list[str] | None`, `Event.subject_key: list[str] | None`, `EventInput.subjects: Sequence[str] | None` used consistently across tasks.
