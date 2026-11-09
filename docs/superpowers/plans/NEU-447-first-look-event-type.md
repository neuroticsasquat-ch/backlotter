# First Look Event Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop classifying screened/described footage and other non-video visual reveals as `trailer`; introduce a new `first_look` event type that reserves `trailer` for actually-released promotional videos.

**Architecture:** Classification is entirely LLM-driven via the cluster prompt in `link/cluster.py`. We add `first_look` to the allowed event-type set (DB CHECK constraint + Python validation set), rewrite the prompt's visual-reveal rules around the boundary "is there a released video the public can watch?", and surface `first_look` as a visible-but-off-arc beat (no `_EVENT_STAGE` entry, not in `_HIDDEN_EVENT_TYPES`). The frontend gets one display-label entry. The fix is forward-only — no backfill of existing rows.

**Tech Stack:** Backend — Python 3.13, SQLAlchemy 2 (async) + asyncpg, Alembic, pytest, all run in-container via `task`. Frontend — React + TS, Vitest, run in-container via `task`.

## Global Constraints

- **Backend runs in-container only.** Never run `pytest`/`ruff`/`pyright`/`alembic`/`python` on the host — use `task test`, `task lint`, `task typecheck`, `task migrate`, `task makemigration -- "msg"`. Source is bind-mounted (live); dependency changes need `task build` (none here).
- **Frontend runs in-container only.** Use `task test`, `task lint`, `task typecheck`, `task format`. ESLint runs at **zero warnings** (unused imports fail).
- **TDD:** write the failing test first, watch it fail, implement minimally, watch it pass.
- **Backend single integration test file in isolation errors** (known pytest-asyncio quirk) — scope to a directory, e.g. `task test -- tests/integration/news`, or run the whole suite.
- **Commit message conventions differ per repo:**
  - Backend: Conventional Commits subject, **no** Linear ID in subject (optional `Refs NEU-447.` in body), no footer, no `Co-Authored-By`.
  - Frontend: Conventional Commits subject **with** trailing Linear ID parenthetical, e.g. `feat: add first look event label (NEU-447)`.
- **Format before committing** (pre-commit hooks delegate into Docker): run `task format` first, then `git add -A` and commit.
- **Current backend Alembic head:** `c8968b592f4c` (this is the new migration's `down_revision`).
- **Forward-only:** do not re-cluster or backfill existing `trailer` rows.

## PR structure

This spans two repos; ship as **two PRs** under NEU-447 (1 ticket → split per stack, frontend follows backend):

- **Backend PR** (repo `upcoming-movies-backend`) — Tasks 1–3.
- **Frontend PR** (repo `upcoming-movies-frontend`) — Task 4. Blocked by the backend PR (backend defines and emits the new type).

---

## Task 1: Allow `first_look` in the event_type CHECK constraint

**Files:**
- Modify: `upcoming-movies-backend/src/upmovies/news/models.py:75-79`
- Create: `upcoming-movies-backend/migrations/versions/<auto>_add_first_look_event_type.py`
- Test: `upcoming-movies-backend/tests/integration/news/test_event_schema.py`

**Interfaces:**
- Produces: the DB now accepts `Event.event_type == "first_look"`. Tests build the schema from the models via `create_all`, so the model constraint change is what unblocks tests; the migration is for prod parity.

- [ ] **Step 1: Write the failing test** — append to `tests/integration/news/test_event_schema.py`:

```python
async def test_event_accepts_first_look_type(session):
    film, _ = await _film_and_story(session)
    session.add(
        Event(
            film_id=film.id,
            event_type="first_look",
            confidence="confirmed",
            occurred_at=datetime.now(UTC),
        )
    )
    await session.commit()  # must not raise IntegrityError
```

- [ ] **Step 2: Run test, verify it fails**

Run: `task test -- tests/integration/news/test_event_schema.py`
Expected: FAIL — `IntegrityError` from the `ck_event_type` CHECK constraint rejecting `first_look`.

- [ ] **Step 3: Add `first_look` to the model CHECK constraint** — `src/upmovies/news/models.py`, the `ck_event_type` constraint:

```python
        CheckConstraint(
            "event_type IN ('announced', 'casting', 'production_start', "
            "'production_wrap', 'release_date', 'trailer', 'first_look', 'other')",
            name="ck_event_type",
        ),
```

- [ ] **Step 4: Run test, verify it passes**

Run: `task test -- tests/integration/news/test_event_schema.py`
Expected: PASS (and the existing `test_event_rejects_bad_type` still passes).

- [ ] **Step 5: Create the migration** — `migrations/versions/<rev>_add_first_look_event_type.py`. Alembic does not autogenerate CHECK-constraint edits, so author it manually (or run `task makemigration -- "add first_look event type"` then replace the body). Set `down_revision = "c8968b592f4c"`:

```python
"""add first_look event type

Revision ID: <rev>
Revises: c8968b592f4c
"""
from alembic import op

revision = "<rev>"
down_revision = "c8968b592f4c"
branch_labels = None
depends_on = None

_NEW = (
    "'announced', 'casting', 'production_start', 'production_wrap', "
    "'release_date', 'trailer', 'first_look', 'other'"
)
_OLD = (
    "'announced', 'casting', 'production_start', 'production_wrap', "
    "'release_date', 'trailer', 'other'"
)


def upgrade() -> None:
    op.execute("ALTER TABLE news.event DROP CONSTRAINT ck_event_type")
    op.execute(f"ALTER TABLE news.event ADD CONSTRAINT ck_event_type CHECK (event_type IN ({_NEW}))")


def downgrade() -> None:
    op.execute("ALTER TABLE news.event DROP CONSTRAINT ck_event_type")
    op.execute(f"ALTER TABLE news.event ADD CONSTRAINT ck_event_type CHECK (event_type IN ({_OLD}))")
```

- [ ] **Step 6: Apply and verify the migration**

Run: `task migrate` then verify a single head: `task shell` → `alembic heads` (expect one head = the new revision).
Expected: upgrade applies cleanly; one head.

- [ ] **Step 7: Lint, typecheck, format, full test**

Run: `task format && task lint && task typecheck && task test`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
cd upcoming-movies-backend
git add src/upmovies/news/models.py migrations/versions/ tests/integration/news/test_event_schema.py
git commit -m "feat: allow first_look event type"
```

---

## Task 2: Reclassify visual reveals in the cluster prompt

**Files:**
- Modify: `upcoming-movies-backend/src/upmovies/link/cluster.py:29-37` (`_VALID_TYPES`) and `:55-94` (`_INSTRUCTIONS`)
- Test: `upcoming-movies-backend/tests/unit/link/test_cluster_pure.py`

**Interfaces:**
- Consumes: the DB/model now accepts `first_look` (Task 1).
- Produces: the LLM is instructed to emit `first_look` for non-video visual reveals; `apply_cluster_decisions` accepts it because `"first_look" in _VALID_TYPES`.

- [ ] **Step 1: Write the failing tests** — append to `tests/unit/link/test_cluster_pure.py`:

```python
def test_first_look_is_a_valid_type():
    from upmovies.link.cluster import _VALID_TYPES

    assert "first_look" in _VALID_TYPES


def test_parse_cluster_groups_first_look_type():
    raw = (
        '{"events": [{"existing": null, "type": "first_look", "confidence": "confirmed",'
        ' "stories": [1]}]}'
    )
    groups = parse_cluster_groups(raw, n_stories=1)
    assert groups is not None
    assert groups[0].event_type == "first_look"


def test_instructions_distinguish_released_video_from_first_look():
    """NEU-447: a trailer is a RELEASED video the public can watch; footage merely
    screened/described, concept art, character designs, and first-look photos are
    'first_look', not 'trailer'."""
    text = _INSTRUCTIONS.lower()
    assert "first_look" in text
    assert "released" in text  # the trailer boundary hinges on a publicly released video
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `task test -- tests/unit/link/test_cluster_pure.py`
Expected: the three new tests FAIL (`first_look` absent from set and prompt).

- [ ] **Step 3: Add `first_look` to `_VALID_TYPES`** — `src/upmovies/link/cluster.py`:

```python
_VALID_TYPES = {
    "announced",
    "casting",
    "production_start",
    "production_wrap",
    "release_date",
    "trailer",
    "first_look",
    "other",
}
```

(Leave `_STALE_EVENT_TYPES` unchanged — `first_look`, like `trailer`, can legitimately appear at any stage.)

- [ ] **Step 4: Rewrite the visual-reveal rules and the type enumeration in `_INSTRUCTIONS`.** Replace the four bullets currently at lines ~68–75 (the `trailer`/first-look/promo-still/role-announcement block) with:

```python
- "trailer" means a promotional VIDEO that has been RELEASED for the public to watch (a \
trailer or teaser the audience can view now). Naming cast does not change this.
- "first_look" is any OTHER visual reveal that is NOT a released video: footage screened or \
described at an event or presentation, concept art, animated or CGI character designs, \
first-look photos, or a promotional still of an actor in costume. Naming cast does not \
change this.
- A bare role announcement with no imagery or footage is "casting".
- A release date mentioned in passing inside a casting story stays "casting".
```

Then update the `"type"` enumeration line (~79–80) to include `first_look`:

```python
- "type": one of announced, casting, production_start, production_wrap, release_date, \
trailer, first_look, other
```

(The preceding "DOMINANT, headline beat … Incidental details never change the type" sentence stays — it keeps `test_instructions_state_primary_beat_precedence` green.)

- [ ] **Step 5: Run tests, verify they pass**

Run: `task test -- tests/unit/link/test_cluster_pure.py`
Expected: PASS — including the pre-existing `test_instructions_state_primary_beat_precedence` and `test_instructions_describe_region_alpha2`.

- [ ] **Step 6: Lint, typecheck, format, full test**

Run: `task format && task lint && task typecheck && task test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
cd upcoming-movies-backend
git add src/upmovies/link/cluster.py tests/unit/link/test_cluster_pure.py
git commit -m "feat: classify non-video visual reveals as first_look"
```

---

## Task 3: Confirm `first_look` is visible and off the arc

No source change expected — `first_look` is automatically off-arc (absent from `arc.py` `_EVENT_STAGE`) and visible (absent from `service.py` `_HIDDEN_EVENT_TYPES`). These tests lock that behavior in.

**Files:**
- Test: `upcoming-movies-backend/tests/unit/public/test_arc.py`
- Test: `upcoming-movies-backend/tests/integration/routers/test_public_feed_grouped.py`

**Interfaces:**
- Consumes: events of type `first_look` can exist (Task 1) and the feed-grouped query filters via `_visible_events()` before `most_significant_event_type`, so a hidden `other` never competes with `first_look`.

- [ ] **Step 1: Write the failing arc tests** — append to `tests/unit/public/test_arc.py`:

```python
def test_first_look_contributes_nothing_to_arc():
    # NEU-447: first_look is a visible beat but OFF the arc — like "other" it never advances.
    assert derive_arc_stage("Planned", ["first_look"]) == "announced"
    assert derive_arc_stage("In Production", ["first_look"]) == "shooting"


def test_most_significant_first_look_ranks_below_arc_types():
    # first_look ranks like other (-1): loses to any arc-stage type, wins when alone.
    assert most_significant_event_type(["casting", "first_look"]) == "casting"
    assert most_significant_event_type(["first_look"]) == "first_look"
```

- [ ] **Step 2: Write the failing visibility test** — append to `tests/integration/routers/test_public_feed_grouped.py`:

```python
async def test_grouped_first_look_is_visible_with_its_top_type(client, make_film, add_event):
    # NEU-447: first_look is NOT hidden (unlike "other") and is the top type for a day
    # where it is the only beat.
    film = await make_film(slug="dynamic-duo-2028", title="Dynamic Duo")
    await add_event(
        film=film,
        event_type="first_look",
        summary="first footage screened at the event",
        created_at=datetime(2026, 6, 3, 12, tzinfo=UTC),
    )

    body = (await client.get("/feed/grouped")).json()
    assert body["total"] == 1
    assert body["items"][0]["top_event_type"] == "first_look"
```

- [ ] **Step 3: Run tests, verify they pass immediately (behavior already correct)**

Run: `task test -- tests/unit/public/test_arc.py tests/integration/routers/test_public_feed_grouped.py`
Expected: PASS. If the arc test fails, something added `first_look` to `_EVENT_STAGE` — remove it. If the feed test fails, something added `first_look` to `_HIDDEN_EVENT_TYPES` — remove it.

- [ ] **Step 4: Lint, typecheck, format, full test**

Run: `task format && task lint && task typecheck && task test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
cd upcoming-movies-backend
git add tests/unit/public/test_arc.py tests/integration/routers/test_public_feed_grouped.py
git commit -m "test: lock first_look as visible and off-arc"
```

(Then open the **Backend PR**. PR title: `feat: reclassify non-video visual reveals as first_look (NEU-447)`. Include the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` footer in the PR body.)

---

## Task 4: Add the "First look" display label (Frontend PR)

**Files:**
- Modify: `upcoming-movies-frontend/src/components/film/labels.ts:25-33`
- Test: `upcoming-movies-frontend/src/components/film/labels.test.ts` (create if absent)

**Interfaces:**
- Consumes: backend now emits `event_type === "first_look"` (Backend PR). `EventCard` renders `eventTypeLabel(event.event_type)` as a badge; `event_type` is free-text in `types.ts`, so no type/union change. `ArcStepper`/`ArcStage` are untouched (off the arc).

- [ ] **Step 1: Write the failing test** — `src/components/film/labels.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { eventTypeLabel } from "./labels";

describe("eventTypeLabel", () => {
  it("maps first_look to a friendly label", () => {
    expect(eventTypeLabel("first_look")).toBe("First look");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `task test -- src/components/film/labels.test.ts`
Expected: FAIL — falls back to title-case `"First Look"` (capital L), not `"First look"`.

- [ ] **Step 3: Add the label** — `src/components/film/labels.ts`, in `EVENT_TYPE_LABELS`:

```ts
const EVENT_TYPE_LABELS: Record<string, string> = {
  announced: "Announced",
  casting: "Casting",
  production_start: "Production start",
  production_wrap: "Production wrap",
  release_date: "Release date",
  trailer: "Trailer",
  first_look: "First look",
  other: "Update",
};
```

- [ ] **Step 4: Run test, verify it passes**

Run: `task test -- src/components/film/labels.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, format, full test**

Run: `task format && task typecheck && task lint && task test`
Expected: all green (zero ESLint warnings).

- [ ] **Step 6: Commit**

```bash
cd upcoming-movies-frontend
git add src/components/film/labels.ts src/components/film/labels.test.ts
git commit -m "feat: add first look event label (NEU-447)"
```

(Then open the **Frontend PR**. PR title: `feat: add first look event label (NEU-447)`. Keep the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` footer in the PR body.)

---

## Spec coverage check

- Trailer = released video; `first_look` for all other visual reveals → **Task 2** (prompt rewrite).
- New `first_look` type allowed end-to-end → **Task 1** (constraint + migration), **Task 2** (`_VALID_TYPES`).
- `first_look` visible in feed, off the arc → **Task 3** (regression tests; behavior is default).
- Frontend "First look" label → **Task 4**.
- Forward-only, no backfill → reflected by the absence of any migration data step.
- 1-ticket-per-PR split → **PR structure** section (backend PR Tasks 1–3, frontend PR Task 4).
