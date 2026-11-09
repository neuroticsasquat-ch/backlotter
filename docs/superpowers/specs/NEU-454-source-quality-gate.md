# NEU-454 — Source-quality gate (design)

**Ticket:** [NEU-454 — Bug: Google News searches pull in low quality sources](https://linear.app/neuroticsasquatch/issue/NEU-454/bug-google-news-searches-pull-in-low-quality-sources)
**Repo:** `upcoming-movies-backend`
**Status:** design approved 2026-07-01

## Problem

Google-News search surfaces low-trust aggregators (Mshale, 玩具人 TOY PEOPLE, Bam Smack Pow, News Mobile, …). These stories get linked, clustered, and **confirmed** as events, driving bad beats downstream (e.g. NEU-452: a fake Mshale "trailer" that read as a real, confirmed trailer). Nothing in the pipeline weighs *who published* a story — the CLUSTER LLM sets `confidence` purely from how the article frames the news (`cluster.py:82`), with no notion of source reputation.

We want a **soft gate**: low-trust domains cannot *confirm* an event on their own, and admin-blocked domains are dropped entirely — without hard-filtering everything low-trust out of existence.

## Key findings that shaped this design

1. **URL resolution runs last, not first.** Contrary to the ticket's "blocked by NEU-455" framing, `resolved_url` is populated in **Phase 3 of the *synthesize* pipeline** (`synthesize/url_resolution.py`), *after* LINK/CLUSTER/SUMMARIZE, and only for Google-News stories already displayed on events. So a resolved publisher domain is **not** available at LINK/CLUSTER time. This design resolves domains itself, for the linked subset, at cluster time.
2. **`Event.confidence` already exists** as `'confirmed' | 'rumored'` (`news/models.py`). The ticket's "low-trust beat becomes rumored" mechanic needs no new representation — only a new signal that flips it.
3. **Production status is already TMDB-only** (`ingest/tmdb/upsert.py` copies `details.status`; events never write status). NEU-452's open question ("should the status tracker rely solely on TMDB status?") is effectively already answered — 454's gating is the real fix for the fake-trailer symptom, by keeping such an event from being `confirmed`.

## Approach

**Gate at CLUSTER/confidence time (approach B):** resolve domains and judge trust only for stories that actually reach clustering (linked, unclustered), rather than resolving every fetched story (approach A) or gating on the unreliable feed-source name (approach C). This respects the existing pipeline shape, pays resolution cost only for stories that matter, and plugs straight into the existing `confidence` field.

The backend for the admin override lever lives in **this** ticket (table + gating + read/write endpoints); [NEU-456](https://linear.app/neuroticsasquatch/issue/NEU-456/admin-lever-to-blacklist-trust-news-source-domains-frontend) is frontend-only and wires against these endpoints.

## Components

### 1. Table: `news.source_domain`

Keyed by normalized registrable domain, cached (judge-once):

| column | type | notes |
|---|---|---|
| `domain` | text, PK | normalized registrable domain, e.g. `mshale.com` |
| `llm_tier` | text | `trusted` / `acceptable` / `low` — CHECK constraint |
| `llm_reason` | text, nullable | one-line justification from the judge |
| `llm_model` | text, nullable | model that judged it (mirrors `event_summary.model`) |
| `admin_override` | text, not null, default `none` | `none` / `block` / `allow` / `trust` — CHECK constraint |
| `first_seen_at` | timestamptz, not null | first time the domain was encountered |
| `judged_at` | timestamptz, nullable | when the LLM tier was assigned |
| `updated_at` | timestamptz, not null | last mutation (judge or override) |

- New Alembic revision off current head `46406c2cc268`, using the CHECK-constraint style of `d1b0671be1d5_add_story_url_resolution_columns.py`.
- Named `source_domain` (not the ticket's bare `source`) to avoid collision with the existing `story.source` feed-name string.

**Effective tier** — the single value the gate consumes, resolving `admin_override` precedence over `llm_tier`:

| `admin_override` | effective tier |
|---|---|
| `block` | **blocked** (hard drop) |
| `trust` | `trusted` |
| `allow` | `acceptable` |
| `none` | `llm_tier` (or the unresolved default, see below) |

### 2. Domain derivation (pre-CLUSTER step)

A new step in `run_link_ingest`, **after LINK, before CLUSTER**, over the linked-and-unclustered batch:

- **Non-Google URL** → extract domain directly from `story.url` (no network).
- **Google-News redirect URL** → reuse `news/resolve.py` to resolve, persist `resolved_url` + `resolve_state` on the story, then extract the domain. This front-loads NEU-455's resolution for the subset that becomes events; synthesize's Phase-3 resolver is unchanged and idempotently skips rows already `resolved`.
- **Unresolvable Google URL** → effective tier defaults to **`acceptable` (neutral)**, controlled by a config knob (`SOURCE_UNRESOLVED_TIER`, default `acceptable`). Rationale: the gate's job is to catch *known* low-quality domains, not to punish resolution *failures* — failing conservative (`low`) would silently flood events into `rumored` whenever the best-effort resolver misses.
- **Normalization** → registrable domain via **`tldextract`** (new dependency), so `m.mshale.com`, `www.mshale.com`, and `mshale.com/amp` collapse to one tier instead of fragmenting across subdomains. A proper Public-Suffix-List extraction is chosen over a hand-rolled `www`-strip to handle multi-part TLDs (`bbc.co.uk`) correctly.

### 3. SOURCE-JUDGE sub-stage (unknown domains only)

After derivation, collect the domains **not** already present in `source_domain` and judge them in **one batched Haiku 4.5 call** (JSON-in / JSON-out, mirroring the linker's batch pattern in `link/linker.py`):

- **Input:** list of `{domain, sample_headline}` (a representative title gives the judge context).
- **Output:** `[{domain, tier, reason}]` where `tier ∈ {trusted, acceptable, low}`.
- **Persistence:** upsert each verdict into `source_domain` with `llm_model` and `judged_at`.
- Known domains are **never re-judged**. Parsing reuses the permissive JSON-extraction helpers already in the codebase.
- Config knobs: `SOURCE_JUDGE_MODEL` (default `claude-haiku-4-5`), `SOURCE_GATE_ENABLED` (default on).

### 4. The gate — two deterministic actions

- **Hard-drop (admin block):** any linked story whose effective tier is **blocked** → `link_status='rejected'`, `link_note='source-blocked'`, excluded from clustering. `block` is admin-only; the LLM never emits it.
- **Confidence override (post-CLUSTER):** for each new or updated event, take the **best** effective tier among its attached stories:
  - best tier is `trusted` or `acceptable` → **keep** the CLUSTER LLM's `confidence` verdict.
  - best tier is `low` (every source is low-trust) → **force `confidence='rumored'`**, overriding the LLM.
  - Rule (i): low-trust never reaches `confirmed`, alone *or* in aggregate. No corroboration threshold.

New module **`news/source_quality.py`** holds table ops, normalization, the judge call, and effective-tier resolution — all pure and unit-testable. `link/pipeline.py` wires the derivation + judge + gate into `run_link_ingest`; the confidence override hooks into the event-persistence path (`apply_cluster_decisions` or an immediately-following step).

### 5. Admin endpoints (human-facing)

Following the `moderation_admin.py` pattern (`require_current_admin` + `require_csrf`, per NEU-440):

- `GET /admin/sources` → list `source_domain` rows (`domain`, `llm_tier`, `llm_reason`, `admin_override`, `updated_at`), for NEU-456's Sources page.
- `POST /admin/sources/{domain}/override` → body `{override: block|allow|trust|none}`; upserts `admin_override`, bumps `updated_at`, returns the row.

Pure DB I/O lives in `news/source_quality.py`; routes register on the existing human-facing admin router.

## Data flow

```
FETCH ──▶ LINK ──▶ [derive domains ▶ judge unknown ▶ hard-drop blocked] ──▶ CLUSTER ──▶ [confidence override] ──▶ SYNTHESIZE
                    └─────────────── new SOURCE-JUDGE sub-stage ───────────┘            └─ post-cluster rule ─┘
```

## Testing

Unit tests (LLM mocked throughout):
- domain normalization (subdomains, `www`, AMP paths, multi-part TLDs collapse correctly)
- effective-tier resolution (override precedence over `llm_tier`; each override value)
- confidence-override rule (all-low → `rumored`; mixed → keep LLM verdict; trusted/acceptable present → keep)
- hard-drop of admin-`block`ed stories (rejected, excluded from clustering)
- judge JSON parse + permissive recovery
- unresolvable-domain default tier honored
- admin endpoints: auth-gating (`require_current_admin` + CSRF), list shape, override upsert round-trip

Run full local CI (alembic heads check + pytest) before opening the PR.

## Acceptance criteria

- `news.source_domain` table exists with LLM-judge populating unknown domains lazily, cached (never re-judged).
- Low-trust single-source (or all-low) beats are downgraded to `confidence='rumored'`; admin-`block`ed domains are dropped from ingestion.
- Admin can list source domains with tier/reason/override and set/clear a per-domain override via the new endpoints; override always wins over the LLM verdict.
- Measurable drop in low-trust-sourced *confirmed* events. Tests included and green.

## Out of scope

- **NEU-456** frontend Sources page (wires against the endpoints defined here).
- Corroboration threshold (rule (ii): N≥2 independent low-trust domains → `confirmed`) — add later only if too many real beats stick at `rumored`.
- Backfilling / judging domains of already-stored historical stories — the table populates lazily as new stories flow through the pipeline.
- Any change to how production status is computed (already TMDB-only; see finding 3).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
