# Summarization service (Haiku 4.5, batched, paraphrase-only) — Design

- **Date:** 2026-06-22
- **Status:** Approved (ready for implementation plan)
- **Component:** `upcoming-movies-backend` — new `synthesize` package, `llm` client (reuse), `config`
- **Linear:** NEU-304 (one PR, backend) · project *Movies: Synthesis & Update Log* · milestone *M1 — Summarization engine*
- **Blocked by:** NEU-303 (`news.event_summary` schema + migration) — ✅ done (PR #31)
- **Blocks:** NEU-305 (`synthesize` pipeline + ingest kind + trigger + cron)
- **Design-of-record:** [2026-06-22-synthesis-update-log-design.md](2026-06-22-synthesis-update-log-design.md) §"Summarization service". This document is the per-ticket implementation design for the M1 service deliverable.

## What this is

The pure service that turns one `news.event` (with its member stories) into one neutral
2–3 sentence plain-language paraphrase — facts in our own words, reproducing nothing. It reuses
the already-built `AnthropicClient` (`complete` + `complete_batch`, prompt caching, Batches) and
mirrors the Stage-1 link service's shape, but **per event** instead of per story-chunk.

NEU-304 ships **only the pure service + prompt + config**: the request builders, the response
parser, a sequential `summarize_event`, the input/output DTOs, and three config fields. It touches
**no database** — it operates entirely on an in-memory `EventInput` and returns a `SummaryResult`
for the caller to persist. The DB selection of stale events, the ORM→`EventInput` mapping, the
batched stage orchestration, and the `event_summary` upsert are all **NEU-305**.

### Out of scope (NEU-305 and later)

- The `synthesize` pipeline (`_summary_stage_sequential` / `_summary_stage_batched`), stale-event
  selection (`event_summary` missing OR `event.updated_at > source_updated_at`), the ORM→`EventInput`
  mapping, and the `event_summary` upsert → **NEU-305**.
- The `ingest.ingest_run.kind` `synthesize` constraint, the `POST /admin/ingest/synthesize` trigger,
  and the daily cron step → **NEU-305**.
- `catalog.film.slug`, the public read API, SSR → later milestones (M2–M4).
- No migration, no router, no frontend, no new **required** env.

## Key decisions

| Question | Decision |
|---|---|
| Confidence (confirmed/rumored) in the prose | **Preserve source certainty.** The `confidence` flag is *not* passed to the prompt; the prompt instructs the model to keep rumors as rumors (never upgrade a "reportedly" to flat fact), mirroring the source deks. The public per-event confirmed/rumored badge carries the explicit signal. Keeps the input exactly as the design-of-record lists it. |
| Output format | **JSON envelope** `{"summary": "..."}`, extracted and parsed — consistent with the link/cluster JSON discipline and robust against preamble / stray quotes. |
| Service input / boundary | **Pure `EventInput` DTO.** NEU-304 is 100% DB/ORM-free; NEU-305 maps ORM→`EventInput`. The linker takes ORM `Story` objects because it *mutates them in place*; summarization is read-only and returns a value, so that precedent doesn't transfer — a DTO gives the crispest boundary and lets the service be unit-tested with plain dataclasses. |
| Prompt caching | **None** (plain system block, no `cache_control`). Unlike the linker's large cached roster prefix, the summary instructions are short (~250 tokens, below Haiku's ~1024-token minimum cacheable size) and each event's payload differs — per the NEU-297/298 measurement finding, caching a sub-minimum prefix is a no-op, so we don't imply a benefit that isn't there. |
| Output token budget | `_MAX_TOKENS = 256` — a 2–3 sentence summary is ~60–120 tokens; ample headroom. |
| Batched orchestration | NEU-304 ships the reusable **pieces** (`build_summary_batch_request` + `parse_summary`) and proves the batched path round-trips in its own tests; the batched **stage loop** (build all → `complete_batch` → parse each → upsert per event with commit-per-batch isolation) is NEU-305, exactly as `_link_stage_batched` lives in `pipeline.py`, not `linker.py`. |

## Package layout

A new `synthesize/` package mirroring `link/`:

```
src/upmovies/synthesize/
  __init__.py          # re-exports via `import x as x`
  summarizer.py        # DTOs, prompt, build/parse/summarize, client protocols
```

NEU-305 later adds `synthesize/pipeline.py`.

## Interface — the DTOs (the NEU-304 ↔ NEU-305 contract)

```python
@dataclass(frozen=True)
class StoryInput:
    title: str
    dek: str                              # raw story.raw["summary"]; truncated at build time
    source: str

@dataclass(frozen=True)
class EventInput:
    event_type: str
    film_title: str
    source_updated_at: datetime           # event.updated_at — echoed into provenance
    stories: Sequence[StoryInput]

@dataclass(frozen=True)
class SummaryResult:
    summary: str
    model: str
    prompt_version: str
    source_updated_at: datetime           # == EventInput's; the event_summary staleness key
```

`SummaryResult` is exactly what NEU-305 upserts into `news.event_summary` (minus `generated_at`,
which is `server_default now()`). NEU-305 builds `EventInput` from `Event` + `EventStory`→`Story` +
`Film`; the dek field carries the raw `story.raw["summary"]` string and is truncated inside
`build_summary_request`, so the prompt-coupled shaping stays next to the prompt. Precondition: an
`EventInput` has ≥1 story (events are built from clustered stories); the service does not guard
empties.

## The prompt

**System block** (plain text, no `cache_control`):

```
You write neutral, factual update blurbs for an upcoming-movies tracker.

You are given one tracked film, the TYPE of news beat being reported, and the
stories that report it (each a headline, a short dek, and its publication's
name). Write ONE update of 2–3 sentences summarizing this beat for a reader
following the film.

Rules:
- Strict paraphrase. State the facts (who / what / when) entirely in your own
  words. Reproduce no phrasing from the headlines or deks — no quoted fragments,
  no distinctive wording lifted verbatim.
- Neutral register. Report what happened plainly; no hype, opinion, clickbait,
  or editorializing.
- Preserve certainty. Never present a report or rumor as established fact. If the
  sources hedge ("reportedly", "is said to"), hedge; if they confirm, state it
  plainly. Never upgrade the sources' level of certainty.
- Stay within the sources. Add no facts, dates, names, or speculation not present
  in the provided material.
- Refer to the film by its title where natural. 2–3 sentences, one paragraph.

Return ONLY a JSON object, no prose or markdown:
{"summary": "<your 2–3 sentence update>"}
```

**User message** — `json.dumps` of the event payload:

```json
{
  "film": "<film_title>",
  "event_type": "casting",
  "stories": [
    {"title": "...", "dek": "...", "source": "Deadline"}
  ]
}
```

The "Preserve certainty" rule implements the preserve-source-certainty decision — no `confidence`
flag is passed; the model mirrors the sources' own hedging.

## Function surface (mirrors the linker quartet, per event)

```python
class Completer(Protocol):
    async def complete(self, *, model, system, messages, max_tokens=...) -> str: ...

class BatchCompleter(Protocol):
    async def complete_batch(self, requests, *, poll_interval=..., timeout=...) -> dict[str, BatchResult]: ...

class SummaryClient(Completer, BatchCompleter, Protocol): ...   # the combined type NEU-305's pipeline uses

_DEK_MAX    = 500     # matches linker's _SUMMARY_MAX
_MAX_TOKENS = 256

def build_summary_request(event: EventInput) -> tuple[list[dict], list[dict]]:
    """Plain system block + JSON event payload — shared by both paths. Truncates each dek to _DEK_MAX."""

def build_summary_batch_request(*, custom_id: str, model: str, event: EventInput) -> BatchRequest:
    """One Message-Batch request for one event. custom_id = event_id (NEU-305 supplies).
    max_tokens = _MAX_TOKENS so the two paths are token-identical."""

def parse_summary(raw: str) -> str:
    """Extract the JSON object (tolerating prose/markdown fences), read ["summary"], strip.
    Raises on missing / empty / malformed output."""

async def summarize_event(
    *, client: Completer, model: str, prompt_version: str, event: EventInput
) -> SummaryResult:
    """Sequential path: build_summary_request → client.complete(max_tokens=_MAX_TOKENS) →
    parse_summary → SummaryResult(summary, model, prompt_version, event.source_updated_at)."""
```

Internal helpers: `_event_payload(event)` (builds the dict, truncating deks) and
`_extract_json_object(text)` (the `{`…`}` analog of the linker's `_extract_json_array`).

The three protocols mirror `linker.py` (`Completer` / `BatchCompleter` / `LinkClient`). The injected
`AnthropicClient` already satisfies `SummaryClient`; unit-test fakes implement only what they need.

## Config (after the `link_*` block in `config.py`)

```python
summary_model: str = Field(default="claude-haiku-4-5", alias="SUMMARY_MODEL")
summary_use_batches: bool = Field(default=True, alias="SUMMARY_USE_BATCHES")
summary_prompt_version: str = Field(default="1", alias="SUMMARY_PROMPT_VERSION")
```

No new **required** env (`ANTHROPIC_API_KEY` already exists). `summary_use_batches` defaults **True**,
matching the post-NEU-297 link default (batches won on cost). `summary_prompt_version` is a free Text
value; bumping it is how NEU-305 forces regeneration on a prompt change.

## Error handling

| Failure | Behavior |
|---|---|
| Model output is unparseable / not a JSON object / missing `summary` / empty after strip | `parse_summary` **raises** (mirrors `apply_link_decisions`' `json.loads` raising). NEU-304 does not catch. |
| Isolation across events | Owned by NEU-305: its per-event `try/except` + commit-per-batch leaves a failed event unsummarized (stays missing/stale) so the next `synthesize` run retries it; one failure never rolls back others. |
| Empty `EventInput.stories` | Not guarded — precondition is ≥1 story (clustered events always have members). |

## Testing (TDD; injected fakes; never live, per repo convention)

`tests/unit/synthesize/test_summarizer.py`:

- **`build_summary_request`** — system block carries the strict-paraphrase + preserve-certainty
  rules and is a plain block (no `cache_control`); the user payload has `film`, `event_type`, and
  each story's `title` / `dek` / `source`; each dek is truncated to `_DEK_MAX`.
- **`build_summary_batch_request`** — `custom_id` / `model` / `max_tokens == _MAX_TOKENS` carried;
  its system + messages are identical to `build_summary_request` for the same event (parity).
- **`parse_summary`** — extracts from `{"summary": "..."}`; tolerates markdown fences / preamble;
  strips whitespace; **raises** on missing / empty / malformed.
- **`summarize_event` (sequential)** — a fake `Completer` returning a JSON envelope yields a
  `SummaryResult` with the parsed `summary`, the passed `model` / `prompt_version`, and the echoed
  `source_updated_at`; a multi-story event's payload includes every member story's title/dek/source.
- **Batched path** — `build_summary_batch_request` → a fake `complete_batch` returning
  `BatchResult(ok=True, text=envelope)` → `parse_summary` yields the same summary as the sequential
  path (the batched-path parity proof at the service level).

`tests/unit/test_config.py` — the three new defaults (`summary_use_batches` is **True**) + env
overrides.

`task format` first, then `task test` / `task lint` / `task typecheck` green. Commit normally
(pre-commit hooks delegate into the container — no `--no-verify`).

## Files touched

- **New** `src/upmovies/synthesize/__init__.py` — re-exports.
- **New** `src/upmovies/synthesize/summarizer.py` — DTOs (`StoryInput` / `EventInput` /
  `SummaryResult`), the `_INSTRUCTIONS` prompt, `_event_payload` / `_extract_json_object`,
  `build_summary_request` / `build_summary_batch_request` / `parse_summary` / `summarize_event`, and
  the `Completer` / `BatchCompleter` / `SummaryClient` protocols. Imports `BatchRequest` / `BatchResult`
  from `upmovies.llm.client`.
- **Modify** `src/upmovies/config.py` — add `summary_model` / `summary_use_batches` /
  `summary_prompt_version`.
- **New** `tests/unit/synthesize/test_summarizer.py`; **modify** `tests/unit/test_config.py`.

## Delivery

One backend PR on the ticket's branch
(`tom/neu-304-backend-summarization-service-haiku-45-batched-paraphrase`). No migration, no FE.
Implement in a Sonnet/high session per the model/effort workflow; this Opus session produced the
design only.
