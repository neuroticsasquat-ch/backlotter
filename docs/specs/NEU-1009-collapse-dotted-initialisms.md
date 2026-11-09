# NEU-1009 — Collapse dotted and slashed initialisms before tokenizing

**Ticket:** [NEU-1009](https://linear.app/neuroticsasquatch/issue/NEU-1009/retrieval-cannot-reach-films-whose-titles-tokenize-to-nothing)
**Design context:** ADR-0008 (lexical-only candidate retrieval), `docs/specs/2026-08-06-entity-linking-candidate-retrieval-design.md`
**Status:** ready to implement

---

## 1. What is actually broken

The ticket is filed as *"retrieval cannot reach films whose titles tokenize to nothing."* That
framing is wrong, and getting it right is what determines the fix.

The reported miss is real. `Warner Bros’ ‘F.A.S.T.’ Dashes Into Summer 2027`
([Deadline](https://deadline.com/2026/08/f-a-s-t-release-date-warner-bros-1237016487/), 2026-08-03,
`link_status = linked`) retrieves two irrelevant films and scores the tracked film **F.A.S.T.**
(tmdb `556682`) at nothing at all:

```
retrieved today:  0.500 'Summer Days'   0.500 'Summer Meadow'
F.A.S.T.       :  score None, rank None
```

But **F.A.S.T. is not tokenless.** Its searchable titles are:

```
'F.A.S.T.'    tokens=()           folded='fast'
'Fast'        tokens=('fast',)    folded='fast'     <- a perfectly good token
'粉红巴比伦'   tokens=('粉红巴比伦',) folded='粉红巴比伦'
```

The alternative title `"Fast"` already indexes the film under `fast`. The join fails on the
**story** side: `significant_tokens("Warner Bros’ ‘F.A.S.T.’ Dashes Into Summer 2027")` returns
`['warner', 'bros', 'dashes', 'into', 'summer', '2027']`. The headline spells the film the same
dotted way the title does, so its single letters are dropped by the same `len(t) > 1` rule that
drops the title's. There is no `fast` on either side of the index lookup for the title route, and
the fold route declines because `squash_fold("F.A.S.T.")` is four characters, under
`SQUASH_FOLD_MIN_CHARS = 6`.

**This kills option 3 in the ticket.** Indexing a synthetic token on the film side gives the token
index nothing to match against, because the story side still emits no `fast`. Any token-route fix
must change tokenization on *both* sides.

There is a second, distinct defect. Sampling the active catalog, exactly **one** film has no token
on any title *and* no rescue fold: **`S/H/V`** (tmdb `1612048`, `Rumored`, 2027-02-04). It is
*slash*-separated, not dotted. The two defects share a shape but not a cause, and the fix below is
scoped to cover both.

## 2. What to build

One change, in `src/upmovies/link/retrieval/normalize.py`, applied inside `significant_tokens`
before the word split — so titles and story text move together by construction:

```python
# A run of initials reads as one word: "F.A.S.T." names the same thing as "FAST", and a
# headline that writes it dotted must reach a title that writes it dotted.
_INITIALISM_RE = re.compile(r"(?:(?<![^\W_])[^\W\d_][./]){2,}[^\W\d_]?")

# The collapse *invents* a token the surface text never literally contains, so it is held to a
# stricter bar than the >1-character rule ordinary tokens face. Below this the run is left
# alone and tokenizes exactly as it does today.
COLLAPSED_INITIALISM_MIN_CHARS = 3
```

A run is **two or more** `<letter><separator>` pairs, where the separator is `.` or `/`, plus an
optional bare trailing letter. It must not begin immediately after an alphanumeric, so it cannot
fire mid-word. When the collapsed form reaches `COLLAPSED_INITIALISM_MIN_CHARS`, it replaces the
run; otherwise the run is left untouched.

```
"F.A.S.T."            -> "fast"                    "U.S. box office" -> unchanged  (2 chars)
"S/H/V"               -> "shv"                     "9/11 anniversary"-> unchanged  (digits)
"R.E.M. Documentary"  -> "rem documentary"         "A/B test"        -> unchanged  (1 pair)
"R.I.P. legend"       -> "rip legend"              "v1.2.3 release"  -> unchanged  (digits)
"J.R.R. Tolkien"      -> "jrr tolkien"             "Spider-Man"      -> unchanged  (no sep)
```

`COLLAPSED_INITIALISM_MIN_CHARS` is a **module constant beside `SQUASH_FOLD_MIN_CHARS`**, not a
`Settings` field. T and K live in config because they are operating levers to be moved without a
deploy; this is a normalization invariant, and the neighbouring fold guard sets the precedent.

Nothing else changes. `squash_fold` already strips periods and slashes, so it needs no edit;
`SQUASH_FOLD_MIN_CHARS`, T, K, and the index structures are untouched.

## 3. Key decisions, and why

### 3.1 The token route, not the fold route

The ticket's option 2 — relax `SQUASH_FOLD_MIN_CHARS` for titles that tokenize to nothing — is
**closed by evidence**, and the film that motivated the ticket is the one that closes it.

`squash_fold("S/H/V")` is `"shv"`. That string occurs inside `"nashville"`. There are **104
production stories** whose folded text contains it — *Movies and TV shows casting in Nashville*,
and so on. A fold rescue is **full credit (score 1.0)**, so relaxing the guard would put `S/H/V` at
rank 1 of all 104. The guard is not conservative; it is load-bearing.

The token route has no such failure mode because the index matches **whole words**: `breakfast`,
`steadfast` and `fasting` are their own tokens and can never match `fast`.

### 3.2 Symmetric, in `significant_tokens` itself

The principle is *"F.A.S.T." tokenizes as "FAST" does* — a property of tokenization, not of
retrieval. Both modules already document the coupling as deliberate: `normalize.py` calls
`significant_tokens` "the canonical implementation", and `news/title_match.py` says a change here
"moves this filter's behaviour too." A retrieval-local fork would reintroduce exactly the drift
that sharing prevents, and buy nothing — see §5.

### 3.3 A three-character floor

Measured over 98,662 production stories, this is the whole ballgame. Headline initialism runs are
overwhelmingly two-character abbreviations:

| Floor | Headline runs admitted | Hitting an active film | Titles recovered |
|---|---|---|---|
| none (≥2) | 1,366 | **744 occurrences** — `us` ×489 (4 films), `la` ×74 (**33 films**), `uk` ×57, `am` ×55 | + `2.0.`, `A.D.`, `S.S.` |
| **≥3** | 87 | **5** — `spa` ×2, `rock` ×1, `fast` ×2 *(the fix)* | `F.A.S.T.`, `R.A.P.`, `R.E.M.`, `G.O.R.A.`, `S/H/V` |
| ≥4 | 11 | 3 | `F.A.S.T.`, `G.O.R.A.` only — abandons `R.A.P.`, `R.E.M.` |

No floor is untenable: `U.S.` alone would put 489 headlines against *What Lies Between Us* and
friends. A floor of 4 abandons two tracked films with the exact defect the ticket was filed about.

Do **not** implement this by adding the residue to `_STOPWORDS`. That set is shared by all
tokenization, so stopwording `rock` to suppress one false positive would strip it from
*Camp Rock 3* and *School of Rock* permanently.

### 3.4 Letters only, no digits

Both variants recover the same five titles, so digits buy nothing — and they cost. With `\w`
participants, date strings like `7/4/2026` and `9.4/10` get chewed into tokens, destroying the
year token and, measurably, candidates:

| | `\w` participants | letters only |
|---|---|---|
| stories **gaining** a candidate | 79 rows / 85 slots | **79 rows / 85 slots** — identical |
| stories **losing** a candidate | **13** | **0** |
| zero-candidate rate | 7,093 → 7,075 | 7,093 → **7,074** |
| numeric index artifacts | 24 (`021`, `131`, `f18`…) | **0** |
| recovers `S/H/V` | yes | yes |

Letters-only strictly dominates. The failure mode is closed by construction rather than tolerated.

### 3.5 Scope covers `S/H/V`

Including `/` as a separator and allowing a bare trailing letter is what reaches `S/H/V`, at a
measured cost of zero lost candidates. `S/H/V` is `Rumored` and no story has ever named it, so
this buys no retrieval today — it is taken because it is free and because the alternative
(relaxing the fold guard) is the catastrophe in §3.1.

## 4. Measured impact

Full before/after over **98,662 stories, 45-day window**, at the operating point:

```
zero-candidate:  7,093 -> 7,074      (7.19% -> 7.17%)   falls; does not rise
distribution:    median 3->3   p90 8->8   p99 15->15   mean 3.7390 -> 3.7398
gaining:         79 stories / 85 film-slots
losing:          0 stories
```

Films newly reachable: **F.A.S.T.**, **R.A.P.**, **R.E.M.**, **G.O.R.A.** (alt title), **S/H/V**.

## 5. Accepted costs

- **Three spurious candidates.** `spa` ×2 (*Spa Weekend*, *Alien Spa*) and `rock` ×1
  (*Camp Rock 3*), each at score 0.5, in three stories out of 98,662.
- **Eleven headlines lose a token** where a bare trailing letter is swallowed by an adjacent word:
  `Y.M.Cinema` → `ymcinema` (×4, loses `cinema`), `A.T.FIELD` → `atfield`, `V/H/S/MIXTAPE` →
  `vhsmixtape`, `S.H.Figuarts` → `shfiguarts`. **Zero titles** lose a token, and **zero candidates**
  were lost — the swallowed words matched no active film.
- **`news/title_match.py` inherits the change.** `title_matches("F.A.S.T.", …)` currently hits the
  high-recall fallback (`no tokens → always keep`) and will begin filtering. This is **dormant in
  production**: `news_google_enabled = False` (ADR-0001) hard-gates the only caller,
  `news/fetcher.py:204`. Directionally an improvement when re-enabled. Re-run
  `scripts/measure_title_filter.py` if that flag is ever flipped.

## 6. Acceptance criteria

1. `significant_tokens("F.A.S.T.") == ["fast"]` and `significant_tokens("S/H/V") == ["shv"]`.
2. `significant_tokens("U.S. box office")` is **unchanged** from today (`["box", "office"]`) — the
   two-character floor holds.
3. The real Deadline headline retrieves F.A.S.T.: `select_candidates` returns it with a non-`None`
   rank.
4. `tests/integration/link/retrieval/test_recall_oracle.py` is green at **94/94**, `RECALL_FLOOR`
   still `1.0`.
5. `scripts/tune_retrieval.py --days 45` against the prod-refreshed DB: the zero-candidate rate does
   **not rise**, and median / p90 / p99 candidate counts are **unchanged** (§4).
6. `task test`, `task lint`, `task typecheck` all green.

## 7. Deliverables

| File | Change |
|---|---|
| `src/upmovies/link/retrieval/normalize.py` | `_INITIALISM_RE`, `COLLAPSED_INITIALISM_MIN_CHARS`, the collapse in `significant_tokens`; module docstring covers the rule, the floor, and why the fold route is closed |
| `tests/unit/link/retrieval/test_normalize.py` | collapse cases + the declines in §2's table |
| `tests/fixtures/link/validation_set.json` | +1 real `about` row (`tmdb 556682`, `event_type: "release_date"`, `is_production_news` unset) |
| `tests/fixtures/link/retrieval_catalog.json` | regenerate via `python scripts/export_retrieval_catalog.py` — it derives films from the labels, so F.A.S.T. is picked up automatically |
| `tests/integration/link/retrieval/test_recall_oracle.py` | `MEASURED_ABOUT_ITEMS` 93 → 94 |
| `tests/unit/link/test_validation_fixture_neu1009.py` | new; pins the row, per the `neu445` / `neu461` / `neu989` precedent |
| `docs/adr/0008-lexical-only-candidate-retrieval.md` | Consequences += the collapse, and the Nashville evidence closing the fold route |

The fixture row uses the **real** story — real URL, outlet, headline (curly quotes), and dek. Its
dek re-states the initialism (*"…its special forces commando pic, F.A.S.T. to mid-May…"*), so the
row exercises the collapse on both fields. Removing the collapse takes the oracle to 93/94, red.

## 8. Out of scope

- No change to `SQUASH_FOLD_MIN_CHARS`, T (`0.5`), K (`25`), or the index structures.
- No new ADR — this is a refinement inside ADR-0008, recorded there.
- No ASCII/accent folding (ADR-0008: unmeasured signals do not enter).
- No handling of initialisms written without their separators (`FAST` bare) — that already
  tokenizes correctly.
- A run written without its trailing separator *and* without a trailing letter is not a case that
  exists in the catalog and is not handled.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
