"""Turn the undated-candidate probe CSV into the spec §4.3 table.

Stdlib only; runs on the host. Usage: python3 summarize_probe.py <csv>

The headline is the *director-reached* column: the directors tranche opens alone,
so that is the population the first flip actually admits. The all-candidates
column is what later tranches would add on top.
"""

import csv
import sys
from collections import Counter


def load(path):
    with open(path, newline="") as fh:
        rows = list(csv.DictReader(fh))
    for r in rows:
        r["seed_attachment_count"] = int(r["seed_attachment_count"])
        r["roles"] = set(filter(None, r["seed_roles_matched"].split("|")))
    return rows


def pct(n, d):
    return f"{100 * n / d:.1f}%" if d else "—"


def threshold_table(rows):
    directors = [r for r in rows if "director" in r["roles"]]
    total, dtotal = len(rows), len(directors)
    out = [
        "### Admitted by corroboration threshold",
        "",
        "| T | all candidates | % | director-reached | % |",
        "|---|---|---|---|---|",
    ]
    for t in (1, 2, 3, 4, 5):
        a = sum(1 for r in rows if r["seed_attachment_count"] >= t)
        d = sum(1 for r in directors if r["seed_attachment_count"] >= t)
        label = f"{t}+" if t == 5 else str(t)
        out.append(f"| ≥{label} | {a} | {pct(a, total)} | {d} | {pct(d, dtotal)} |")
    return "\n".join(out), directors


def dist(rows, key, title, limit=12):
    c = Counter(r[key] for r in rows)
    total = len(rows)
    out = [f"### {title}", "", f"| {key} | n | % |", "|---|---|---|"]
    for k, n in c.most_common(limit):
        out.append(f"| {k or '(none)'} | {n} | {pct(n, total)} |")
    if len(c) > limit:
        rest = sum(n for _, n in c.most_common()[limit:])
        out.append(f"| _{len(c) - limit} more_ | {rest} | {pct(rest, total)} |")
    return "\n".join(out)


def histogram(rows, title):
    c = Counter(r["seed_attachment_count"] for r in rows)
    total = len(rows)
    out = [f"### {title}", "", "| seed attachments | n | % |", "|---|---|---|"]
    for k in sorted(c):
        out.append(f"| {k} | {c[k]} | {pct(c[k], total)} |")
    return "\n".join(out)


def roles_dist(rows):
    c = Counter("+".join(sorted(r["roles"])) for r in rows)
    total = len(rows)
    out = ["### Seed roles matched on the candidate", "", "| roles | n | % |", "|---|---|---|"]
    for k, n in c.most_common():
        out.append(f"| {k or '(none)'} | {n} | {pct(n, total)} |")
    return "\n".join(out)


def main(path):
    rows = load(path)
    tbl, directors = threshold_table(rows)
    print(f"# Undated-candidate probe — {len(rows)} candidates\n")
    print(f"Director-reached: **{len(directors)}** ({pct(len(directors), len(rows))})\n")
    print(tbl, "\n")
    print(roles_dist(rows), "\n")
    print(histogram(rows, "Attachment-count histogram (all)"), "\n")
    print(histogram(directors, "Attachment-count histogram (director-reached)"), "\n")
    print(dist(directors, "status", "Status — director-reached"), "\n")
    print(dist(directors, "original_language", "Language — director-reached"), "\n")


if __name__ == "__main__":
    main(sys.argv[1])
