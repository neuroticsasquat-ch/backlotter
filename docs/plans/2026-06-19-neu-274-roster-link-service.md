# NEU-274: Roster builder + LLM link service (Stage 1) + confidence floor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the prompt-cached film roster and the per-batch LLM link service that classifies each story as about / mention / no-match against a tracked film and applies the confidence floor.

**Architecture:** A new `src/upmovies/link/` package. `roster.py` queries `catalog.film` into a compact, indexed `Roster` (films referenced by 1-based index, not raw UUIDs, so the model never has to copy ids). `linker.py` exposes `link_story_batch(...)`: it builds a cached system block (instructions + roster), sends one batch of stories as the user message, parses the JSON array of decisions, applies the floor, and mutates the passed `Story` objects' link state. The function takes an injected `Completer` (the `AnthropicClient` from NEU-273) so tests use a fake — no network, no DB.

**Tech Stack:** SQLAlchemy 2 async, the `llm.AnthropicClient` wrapper (NEU-273), pytest.

**Repo:** `upcoming-movies-backend` · **Branch:** `tom/neu-274-be-roster-builder-llm-link-service-stage-1-confidence-floor` · **Spec:** `docs/specs/2026-06-19-entity-linking-clustering-design.md`

**Depends on:** NEU-272 (link-state columns on `Story`), NEU-273 (`llm.AnthropicClient`, `cached_system_block`, config).

> **Commit/PR convention:** No per-step commits — implement the ticket, run the full check suite, then the user commits once and opens the PR. All commands run in the container via `task`.

---

## File Structure

- **Create** `src/upmovies/link/__init__.py` — re-exports.
- **Create** `src/upmovies/link/roster.py` — `RosterEntry`, `Roster`, `build_roster`.
- **Create** `src/upmovies/link/linker.py` — `Completer` protocol, `BatchLinkResult`, `link_story_batch`.
- **Create** `tests/integration/link/__init__.py`, `tests/integration/link/test_roster.py`.
- **Create** `tests/unit/link/__init__.py`, `tests/unit/link/test_linker.py`.

---

### Task 1: Roster builder

**Files:**
- Create: `src/upmovies/link/roster.py`
- Create: `tests/integration/link/__init__.py` (empty), `tests/integration/link/test_roster.py`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/link/__init__.py` (empty) and `tests/integration/link/test_roster.py`:

```python
from datetime import date

from upmovies.catalog.models import Film, FilmGenre, Genre
from upmovies.link.roster import build_roster


async def test_build_roster_includes_title_year_genre_and_index(session):
    film = Film(tmdb_id=1, title="The Odyssey", release_date=date(2026, 7, 15), overview="Epic.")
    session.add(film)
    await session.flush()
    session.add(Genre(id=12, name="Adventure"))
    await session.flush()
    session.add(FilmGenre(film_id=film.id, genre_id=12))
    await session.commit()

    roster = await build_roster(session)

    assert len(roster.entries) == 1
    entry = roster.entries[0]
    assert entry.title == "The Odyssey"
    assert entry.year == 2026
    assert entry.genres == ["Adventure"]
    assert '#1 "The Odyssey"' in roster.text
    assert "(2026)" in roster.text
    assert roster.film_id_for_index(1) == film.id
    assert roster.film_id_for_index(2) is None
```

- [ ] **Step 2: Run it to verify it fails**

Run: `task test -- tests/integration/link`
Expected: FAIL — `upmovies.link.roster` does not exist.

- [ ] **Step 3: Implement `roster.py`**

Create `src/upmovies/link/roster.py`:

```python
"""Builds the prompt-cached film roster from `catalog.film`. Films are referred to by a
1-based index (not their UUID) so the model never has to copy ids verbatim — the linker
maps the index back to a film_id."""

from collections import defaultdict
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from upmovies.catalog.models import Film, FilmGenre, Genre

_OVERVIEW_MAX = 240


@dataclass(frozen=True)
class RosterEntry:
    film_id: UUID
    title: str
    original_title: str | None
    year: int | None
    overview: str | None
    genres: list[str]


@dataclass(frozen=True)
class Roster:
    entries: list[RosterEntry]
    text: str

    def film_id_for_index(self, index: object) -> UUID | None:
        if isinstance(index, int) and 1 <= index <= len(self.entries):
            return self.entries[index - 1].film_id
        return None


def _render(entries: list[RosterEntry]) -> str:
    lines: list[str] = []
    for i, e in enumerate(entries, start=1):
        parts = [f'#{i} "{e.title}"']
        if e.year is not None:
            parts.append(f"({e.year})")
        if e.original_title and e.original_title != e.title:
            parts.append(f"[orig: {e.original_title}]")
        if e.genres:
            parts.append(f"genres: {', '.join(e.genres)}")
        line = " ".join(parts)
        if e.overview:
            line += f" — {e.overview}"
        lines.append(line)
    return "\n".join(lines)


async def build_roster(session: AsyncSession) -> Roster:
    films = (await session.execute(select(Film).order_by(Film.title))).scalars().all()
    genre_rows = (
        await session.execute(
            select(FilmGenre.film_id, Genre.name).join(Genre, Genre.id == FilmGenre.genre_id)
        )
    ).all()
    genres_by_film: dict[UUID, list[str]] = defaultdict(list)
    for film_id, name in genre_rows:
        genres_by_film[film_id].append(name)

    entries = [
        RosterEntry(
            film_id=f.id,
            title=f.title,
            original_title=f.original_title,
            year=f.release_date.year if f.release_date else None,
            overview=(f.overview[:_OVERVIEW_MAX] if f.overview else None),
            genres=sorted(genres_by_film.get(f.id, [])),
        )
        for f in films
    ]
    return Roster(entries=entries, text=_render(entries))
```

- [ ] **Step 4: Run it to verify it passes**

Run: `task test -- tests/integration/link`
Expected: PASS.

---

### Task 2: Link service (`link_story_batch`)

**Files:**
- Create: `src/upmovies/link/linker.py`
- Create: `tests/unit/link/__init__.py` (empty), `tests/unit/link/test_linker.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/link/__init__.py` (empty) and `tests/unit/link/test_linker.py`:

```python
import json
from uuid import uuid4

from upmovies.link.linker import link_story_batch
from upmovies.link.roster import Roster, RosterEntry
from upmovies.news.models import Story


class FakeClient:
    def __init__(self, response: str):
        self._response = response
        self.calls: list[dict] = []

    async def complete(self, *, model, system, messages, max_tokens=4096) -> str:
        self.calls.append({"model": model, "system": system, "messages": messages})
        return self._response


def _roster(film_id):
    entry = RosterEntry(
        film_id=film_id, title="Runner", original_title=None, year=2026, overview=None, genres=[]
    )
    return Roster(entries=[entry], text='#1 "Runner" (2026)')


def _story(title="A headline", summary=""):
    return Story(
        id=uuid4(), source="X", url=f"https://e/{uuid4()}", title=title, raw={"summary": summary}
    )


async def _run(response, *, floor=0.7):
    film_id = uuid4()
    story = _story()
    client = FakeClient(response(str(story.id)))
    result = await link_story_batch(
        client=client, model="m", roster=_roster(film_id), stories=[story], floor=floor
    )
    return story, film_id, client, result


async def test_about_high_confidence_links():
    story, film_id, _, result = await _run(
        lambda sid: json.dumps([{"id": sid, "film": 1, "confidence": 0.95, "reason": "about"}])
    )
    assert result.linked == 1 and result.rejected == 0
    assert story.link_status == "linked"
    assert story.film_id == film_id
    assert story.link_confidence == 0.95
    assert story.linked_at is not None
    assert story.link_note is None


async def test_mention_is_rejected():
    story, _, _, result = await _run(
        lambda sid: json.dumps([{"id": sid, "film": 1, "confidence": 0.9, "reason": "mention"}])
    )
    assert result.rejected == 1
    assert story.link_status == "rejected"
    assert story.film_id is None
    assert story.link_confidence is None
    assert story.link_note == "mention"


async def test_below_floor_is_rejected():
    story, _, _, _ = await _run(
        lambda sid: json.dumps([{"id": sid, "film": 1, "confidence": 0.4, "reason": "about"}])
    )
    assert story.link_status == "rejected"
    assert story.link_note == "below-floor"


async def test_no_match_is_rejected():
    story, _, _, _ = await _run(
        lambda sid: json.dumps([{"id": sid, "film": None, "confidence": 0.0, "reason": "no-match"}])
    )
    assert story.link_status == "rejected"
    assert story.link_note == "no-match"


async def test_roster_is_sent_as_cached_system_block():
    _, _, client, _ = await _run(
        lambda sid: json.dumps([{"id": sid, "film": None, "confidence": 0.0, "reason": "no-match"}])
    )
    system = client.calls[0]["system"]
    assert system[0]["cache_control"] == {"type": "ephemeral"}
    assert "Runner" in system[0]["text"]


async def test_response_wrapped_in_prose_is_still_parsed():
    story, film_id, _, result = await _run(
        lambda sid: "Here you go:\n```json\n"
        + json.dumps([{"id": sid, "film": 1, "confidence": 0.9, "reason": "about"}])
        + "\n```"
    )
    assert result.linked == 1
    assert story.link_status == "linked"


async def test_omitted_story_is_rejected_no_decision():
    story, _, _, result = await _run(lambda sid: json.dumps([]))  # model returned nothing
    assert result.rejected == 1
    assert story.link_status == "rejected"
    assert story.link_note == "no-decision"
```

- [ ] **Step 2: Run them to verify they fail**

Run: `task test -- tests/unit/link`
Expected: FAIL — `upmovies.link.linker` does not exist.

- [ ] **Step 3: Implement `linker.py`**

Create `src/upmovies/link/linker.py`:

```python
"""Stage 1 link service: classify a batch of stories against the cached roster and apply
the confidence floor, mutating each Story's link state in place. The caller owns the
session/commit. The LLM client is injected (Completer) so this is unit-testable with a fake."""

import json
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from upmovies.link.roster import Roster
from upmovies.llm.client import cached_system_block
from upmovies.news.models import Story

log = logging.getLogger(__name__)

_SUMMARY_MAX = 500
_MAX_TOKENS = 2048

_INSTRUCTIONS = """You are an entity-linking classifier for an upcoming-movies tracker.

You are given a ROSTER of tracked films (each with a numeric index) and a batch of news \
stories (each an id, headline, and short dek). For every story, decide whether it is \
primarily ABOUT exactly one of the tracked films.

Definitions:
- "about": the story's main subject is that tracked film (its casting, release date, \
trailer, production, etc.).
- "mention": the film is only referenced in passing (an aside, a list, a comparison, or \
an actor's other project). Mentions are NOT links.
- "no-match": the story is not about any tracked film. Most stories are no-match — \
unrelated TV, games, sports, obituaries, or already-released films. Returning no-match is \
expected and correct.

Be strict about same-titled / substring traps: the tracked film "Runner" is not \
"showrunner" or "Blade Runner". Use the year, original title, genres, and overview to \
disambiguate.

Return ONLY a JSON array — no prose, no markdown — one object per input story, using the \
story's id:
[{"id": "<story id>", "film": <roster index or null>, "confidence": <0.0-1.0>, "reason": \
"about" | "mention" | "no-match"}]

"confidence" is your probability that the story is about that exact roster film (0.0 for \
mention/no-match)."""


class Completer(Protocol):
    async def complete(
        self,
        *,
        model: str,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        max_tokens: int = ...,
    ) -> str: ...


@dataclass
class BatchLinkResult:
    linked: int
    rejected: int


def _story_payload(stories: Sequence[Story]) -> list[dict[str, str]]:
    payload: list[dict[str, str]] = []
    for s in stories:
        summary = ""
        if isinstance(s.raw, dict):
            summary = str(s.raw.get("summary", ""))[:_SUMMARY_MAX]
        payload.append({"id": str(s.id), "title": s.title, "summary": summary})
    return payload


def _extract_json_array(text: str) -> str:
    """Pull the JSON array out of a response that may be wrapped in prose/markdown fences."""
    start = text.find("[")
    end = text.rfind("]")
    if start == -1 or end == -1 or end < start:
        return text
    return text[start : end + 1]


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

    system = [cached_system_block(f"{_INSTRUCTIONS}\n\nROSTER:\n{roster.text}")]
    messages = [{"role": "user", "content": json.dumps(_story_payload(stories))}]
    raw = await client.complete(
        model=model, system=system, messages=messages, max_tokens=_MAX_TOKENS
    )
    decisions = json.loads(_extract_json_array(raw))  # raises on un-parseable output

    by_id = {str(s.id): s for s in stories}
    now = datetime.now(UTC)
    decided: set[str] = set()
    linked = rejected = 0

    for decision in decisions:
        sid = str(decision.get("id"))
        story = by_id.get(sid)
        if story is None:
            continue
        decided.add(sid)
        film_id = roster.film_id_for_index(decision.get("film"))
        reason = decision.get("reason")
        try:
            confidence = float(decision.get("confidence") or 0.0)
        except (TypeError, ValueError):
            confidence = 0.0

        story.linked_at = now
        if reason == "about" and film_id is not None and confidence >= floor:
            story.link_status = "linked"
            story.film_id = film_id
            story.link_confidence = confidence
            story.link_note = None
            linked += 1
        else:
            story.link_status = "rejected"
            story.film_id = None
            story.link_confidence = None
            if reason == "about" and film_id is not None and confidence < floor:
                story.link_note = "below-floor"
            elif reason == "mention":
                story.link_note = "mention"
            else:
                story.link_note = "no-match"
            rejected += 1

    for sid, story in by_id.items():
        if sid not in decided:
            log.warning("linker returned no decision for story %s", sid)
            story.link_status = "rejected"
            story.link_note = "no-decision"
            story.linked_at = now
            rejected += 1

    return BatchLinkResult(linked, rejected)
```

- [ ] **Step 4: Run them to verify they pass**

Run: `task test -- tests/unit/link`
Expected: PASS (7 tests).

---

### Task 3: Package re-exports

**Files:**
- Create: `src/upmovies/link/__init__.py`

- [ ] **Step 1: Add the re-exports**

Create `src/upmovies/link/__init__.py`:

```python
from upmovies.link.linker import BatchLinkResult as BatchLinkResult
from upmovies.link.linker import Completer as Completer
from upmovies.link.linker import link_story_batch as link_story_batch
from upmovies.link.roster import Roster as Roster
from upmovies.link.roster import RosterEntry as RosterEntry
from upmovies.link.roster import build_roster as build_roster
```

---

## Final verification (before handing off to commit)

- [ ] `task format`
- [ ] `task lint` — clean
- [ ] `task typecheck` — clean (`AnthropicClient` structurally satisfies `Completer`)
- [ ] `task test` — full suite green
- [ ] Hand off: the user commits (e.g. `feat: add film roster + LLM link service with confidence floor`) and opens the PR for NEU-274.

---

## Self-Review

- **Spec coverage:** Implements the roster builder (compact film rows: title/original_title/year/overview/genres) and the Stage-1 link service with the `{film, confidence, reason}` contract and the floor → `linked`/`rejected` + `link_note` outcomes from the spec. Roster-as-cached-system-block matches the prompt-caching decision. Story selection / batching / run-tracking are correctly left to NEU-275.
- **Placeholders:** None — full prompt text, parsing, and floor logic included.
- **Type consistency:** `build_roster -> Roster`, `Roster.film_id_for_index(object) -> UUID | None`, `link_story_batch(*, client: Completer, model, roster, stories, floor) -> BatchLinkResult` are used identically across `roster.py`, `linker.py`, the re-exports, and both test files. The fake client's `complete` signature matches the `Completer` protocol.
- **Decision noted:** films are referenced by 1-based index, not UUID, to avoid id-copy errors; `_extract_json_array` tolerates prose/fence wrapping; un-parseable output raises (NEU-275's pipeline treats that as a failed batch and leaves the stories `pending`).
