import { useState } from "react";
import { Link } from "react-router";
import {
  KIND_FILTER_LABELS,
  KIND_LABELS,
  PATH_LABELS,
  RESOLUTION_KINDS,
  RESOLUTION_PATHS,
  candidateId,
  resolvedEntityPath,
  useResolutionDecisions,
} from "@/api/resolution";
import type {
  ResolutionCandidate,
  ResolutionDecision,
  ResolutionKind,
  ResolutionPath,
} from "@/api/types";
import { Button } from "@/components/ui/button";
import { formatEventDate, truncate } from "@/lib/format";

/** The wire field is a bare string (`story_person.path`), so the page must render a value
 *  outside the D-24 vocabulary rather than index past these maps into `undefined` — a path the
 *  backend grew and this build has not learned yet should read as itself, not as a blank badge. */
const UNKNOWN_PATH_STYLE = "bg-slate-100 text-slate-800";

const PATH_STYLES: Record<ResolutionPath, string> = {
  unlinked: "bg-red-100 text-red-800",
  tiebreak: "bg-amber-100 text-amber-800",
  accepted: "bg-green-100 text-green-800",
  not_in_tmdb: "bg-slate-100 text-slate-800",
};

/** The filter's value, where `all` is the absence of a `path` query param rather than a fifth
 *  path — the backend 422s on anything outside the D-24 vocabulary. */
type PathFilter = ResolutionPath | "all";

/** D-25 asks for a page listing "unlinked and tiebreak decisions", so the queue is where an
 *  admin lands; `accepted` would otherwise dominate the first screen. The other paths stay one
 *  tab away, because the endpoint serves all four and a decision is only inspectable if you can
 *  reach it. */
const DEFAULT_FILTER: PathFilter = "unlinked";

/** People, the kind this page listed before organisations resolved (EF-12) and the kind the
 *  endpoint still answers with when asked for none. There is deliberately no "All": the
 *  backend reads `news.story_person` or `news.story_entity` per request and will not union
 *  them — the two tables have different columns and different keyset orders, so a combined
 *  page would have to interleave two cursors. The filter is the three queues, not four. */
const DEFAULT_KIND: ResolutionKind = "person";

function formatConfidence(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

/** One `features` / candidate-feature bag, which is JSONB with no schema of its own. Numbers
 *  are rounded for reading; anything else is printed as-is so an unexpected shape shows up
 *  as itself rather than as `[object Object]`. */
function FeatureList({ features }: { features: Record<string, unknown> }) {
  const entries = Object.entries(features);
  if (entries.length === 0) {
    return <span className="text-muted-foreground">No features recorded.</span>;
  }
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="font-medium">{key}</dt>
          <dd className="text-muted-foreground">{formatFeatureValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatFeatureValue(value: unknown): string {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(3);
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return JSON.stringify(value);
}

/** One considered person, studio or franchise. A candidate the backend could not validate
 *  comes back with every field null (an empty row, by design) — rendered as "Unnamed
 *  candidate" rather than hidden, because a shortlist entry the resolver could not read is
 *  itself the anomaly worth seeing. */
function CandidateRow({ candidate }: { candidate: ResolutionCandidate }) {
  const id = candidateId(candidate);
  return (
    <li className="rounded border p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium">{candidate.name ?? "Unnamed candidate"}</span>
        {id !== null && id !== undefined && (
          <span className="text-xs text-muted-foreground">TMDB #{id}</span>
        )}
        <span className="ml-auto text-xs">score {formatConfidence(candidate.score)}</span>
      </div>
      <div className="mt-2 text-xs">
        <FeatureList features={candidate.features} />
      </div>
    </li>
  );
}

function DecisionDetail({ row }: { row: ResolutionDecision }) {
  return (
    <div className="space-y-4 bg-muted/30 p-4 text-sm">
      <div>
        <h3 className="font-medium">Evidence</h3>
        <p className="mt-1 text-muted-foreground">
          {row.evidence_span ? `“${row.evidence_span}”` : "No evidence span recorded."}
        </p>
      </div>
      <div>
        <h3 className="font-medium">Decision features</h3>
        <div className="mt-1">
          <FeatureList features={row.features} />
        </div>
      </div>
      <div>
        <h3 className="font-medium">Candidates ({row.candidates.length})</h3>
        {row.candidates.length === 0 ? (
          <p className="mt-1 text-muted-foreground">
            No candidates were shortlisted for this mention.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {row.candidates.map((candidate, i) => (
              // The JSONB carries no stable id, and a shortlist can hold two entries with the
              // same null id, so position is the only key that is actually unique.
              <CandidateRow
                key={`${candidateId(candidate) ?? "none"}-${i}`}
                candidate={candidate}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** One tab of either filter. The two tablists differ only in their vocabulary, so they share
 *  a button rather than each growing their own copy of the selected/unselected styling. */
function FilterTab({
  label,
  isSelected,
  onSelect,
}: {
  label: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isSelected}
      onClick={onSelect}
      className={
        isSelected
          ? "rounded border border-foreground px-3 py-1 text-sm font-medium"
          : "rounded border border-transparent px-3 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      }
    >
      {label}
    </button>
  );
}

export function AdminResolution() {
  const [kind, setKind] = useState<ResolutionKind>(DEFAULT_KIND);
  const [filter, setFilter] = useState<PathFilter>(DEFAULT_FILTER);
  // Cursor paging has no offsets to arithmetic on, so "Previous" is a stack of the cursors
  // already visited: the last entry is the current page, and popping it goes back one.
  const [cursors, setCursors] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const cursor = cursors.at(-1);
  const { data, isLoading, isError, error, isPlaceholderData } = useResolutionDecisions({
    kind,
    path: filter === "all" ? undefined : filter,
    cursor,
  });

  const items = data?.items ?? [];
  const pageNumber = cursors.length + 1;

  // Page 3 of the old filter says nothing about the new one, and its cursor is not even valid
  // there — a kind's cursors are minted from its own table's keyset. Every filter change,
  // either filter, starts over at the first page.
  function resetPaging() {
    setCursors([]);
    setExpanded(null);
  }

  function selectFilter(next: PathFilter) {
    setFilter(next);
    resetPaging();
  }

  function selectKind(next: ResolutionKind) {
    setKind(next);
    resetPaging();
  }

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold">Resolution</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every person, studio and franchise the resolver decided on, with the candidates and feature
        scores behind the call. Read-only — the next run re-derives each path from the scorer's
        inputs.
      </p>

      <div role="tablist" aria-label="Filter by kind" className="mt-4 flex flex-wrap gap-2">
        {RESOLUTION_KINDS.map((value) => (
          <FilterTab
            key={value}
            label={KIND_FILTER_LABELS[value]}
            isSelected={kind === value}
            onSelect={() => selectKind(value)}
          />
        ))}
      </div>

      <div role="tablist" aria-label="Filter by path" className="mt-2 flex flex-wrap gap-2">
        {(["all", ...RESOLUTION_PATHS] as const).map((value) => (
          <FilterTab
            key={value}
            label={value === "all" ? "All" : PATH_LABELS[value]}
            isSelected={filter === value}
            onSelect={() => selectFilter(value)}
          />
        ))}
      </div>

      {isLoading && <p className="mt-4 text-muted-foreground">Loading decisions…</p>}

      {isError && (
        <p className="mt-4 text-red-600">
          Failed to load decisions{error instanceof Error ? `: ${error.message}` : ""}.
        </p>
      )}

      {data && items.length === 0 && (
        <p className="mt-4 text-muted-foreground">
          {filter === "all"
            ? `No ${KIND_LABELS[kind].toLowerCase()} decisions recorded yet.`
            : `No ${PATH_LABELS[filter].toLowerCase()} ${KIND_LABELS[kind].toLowerCase()} decisions.`}
        </p>
      )}

      {items.length > 0 && (
        <>
          <table className="mt-4 w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4 font-medium">Kind</th>
                <th className="py-2 pr-4 font-medium">Story</th>
                <th className="py-2 pr-4 font-medium">Film</th>
                <th className="py-2 pr-4 font-medium">Name as written</th>
                <th className="py-2 pr-4 font-medium">Resolved to</th>
                <th className="py-2 pr-4 font-medium">Evidence</th>
                <th className="py-2 pr-4 font-medium">Path</th>
                <th className="py-2 pr-4 font-medium">Confidence</th>
                <th className="py-2 font-medium">Candidates</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <ResolutionRow
                  key={row.id}
                  row={row}
                  isExpanded={expanded === row.id}
                  onToggle={() => setExpanded((id) => (id === row.id ? null : row.id))}
                />
              ))}
            </tbody>
          </table>

          <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
            <span>Page {pageNumber}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={cursors.length === 0}
              onClick={() => {
                setCursors((c) => c.slice(0, -1));
                setExpanded(null);
              }}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              // Held shut while `keepPreviousData` is showing the previous page: `next_cursor`
              // then still belongs to that page, and under a just-changed filter it is a keyset
              // token minted somewhere else entirely. It would not 400 — cursors are
              // filter-agnostic — it would silently page from the wrong place.
              disabled={isPlaceholderData || !data?.next_cursor}
              onClick={() => {
                const next = data?.next_cursor;
                if (!next) return;
                setCursors((c) => [...c, next]);
                setExpanded(null);
              }}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** The entity a mention resolved to, linked to its own page.
 *
 *  The decision row carries the id it landed on but not that entity's catalogue name — only
 *  the name the story wrote. The shortlist does carry it, so the winning candidate is read for
 *  a display name and the written name stands in when the shortlist has none (a mention
 *  `accepted` off an exact-match shortcut leaves no candidate to match). Either way the slug
 *  is decorative: the ref resolves on its leading id and the page redirects to the canonical
 *  form.
 *
 *  Three of the four paths (`unlinked`, `not_in_tmdb`, and a `tiebreak` the gateway declined)
 *  name nobody, and an em dash is the whole answer for them — this page exists to show that a
 *  mention went nowhere as much as to show where it went. */
function ResolvedEntity({ row }: { row: ResolutionDecision }) {
  if (row.entity_id === null) return <span className="text-muted-foreground">—</span>;

  const winner = row.candidates.find((c) => candidateId(c) === row.entity_id);
  const name = winner?.name ?? row.name_as_written;
  const href = resolvedEntityPath(row.kind, row.entity_id, name);

  if (!href) return <span>{name}</span>;
  return (
    <Link to={href} className="underline underline-offset-2">
      {name}
    </Link>
  );
}

function ResolutionRow({
  row,
  isExpanded,
  onToggle,
}: {
  row: ResolutionDecision;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const role = [row.role, row.department].filter(Boolean).join(" · ");
  return (
    <>
      <tr className="border-b align-top">
        <td className="py-2 pr-4 text-muted-foreground">
          {/* The wire field is a bare string, like `path` above it: a kind this build has not
              learned reads as itself rather than as a blank cell. */}
          {KIND_LABELS[row.kind] ?? row.kind}
        </td>
        <td className="py-2 pr-4">
          <a
            href={row.story.url}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline underline-offset-2"
          >
            {truncate(row.story.title, 80)}
          </a>
          <div className="text-xs text-muted-foreground">
            {row.story.outlet ?? "Unknown outlet"}
            {row.resolved_at ? ` · ${formatEventDate(row.resolved_at)}` : ""}
          </div>
        </td>
        <td className="py-2 pr-4">
          {row.film ? (
            // The bare id, not the canonical `<tmdb_id>-<slug>` ref: `ResolutionFilmOut`
            // ships no `ref`, and the film loader resolves a leading id and 301s to the
            // canonical URL. One redirect, and `Link` keeps it a client navigation.
            <Link to={`/film/${row.film.tmdb_id}`} className="underline underline-offset-2">
              {row.film.title}
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="py-2 pr-4">
          <div className="font-medium">{row.name_as_written}</div>
          {/* Null for an organisation — `news.story_entity` has no column for either. */}
          {role && <div className="text-xs text-muted-foreground">{role}</div>}
        </td>
        <td className="py-2 pr-4">
          <ResolvedEntity row={row} />
        </td>
        <td className="py-2 pr-4 text-muted-foreground">
          {row.evidence_span ? truncate(row.evidence_span, 90) : "—"}
        </td>
        <td className="py-2 pr-4">
          <span
            className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
              PATH_STYLES[row.path] ?? UNKNOWN_PATH_STYLE
            }`}
          >
            {PATH_LABELS[row.path] ?? row.path}
          </span>
        </td>
        <td className="py-2 pr-4">{formatConfidence(row.confidence)}</td>
        <td className="py-2">
          <Button
            size="sm"
            variant="outline"
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? "Hide" : "Show"} candidates for ${row.name_as_written}`}
            onClick={onToggle}
          >
            {row.candidates.length} {isExpanded ? "▲" : "▼"}
          </Button>
        </td>
      </tr>
      {isExpanded && (
        <tr className="border-b">
          <td colSpan={9} className="p-0">
            <DecisionDetail row={row} />
          </td>
        </tr>
      )}
    </>
  );
}

export default AdminResolution;
