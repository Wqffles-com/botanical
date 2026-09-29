#!/usr/bin/env python3
"""Render the Botanical progress dashboard PNG.

Measures first-parent history on origin/main (fetched, not checked out) in
the git checkout that contains this script, unless --repo points somewhere
else. The worktree is left unchanged.

Line additions and deletions are the first-parent diffs on that ref (each
merge counts once, so adds minus deletes equal the tree). Lockfiles and
binaries are excluded. Commit counts include every commit reachable from the
ref. Dates are bucketed in Europe/Amsterdam.

The window starts on 23 Sep 2026 and ends today (Amsterdam). Stat cards and
the total-lines chart cover that whole window. Once the window is longer
than 14 days, the per-day charts show only the last 14 days.

Dependencies (no third-party Python packages; see requirements.txt):
  - Python 3.11+
  - git
  - GitHub CLI (gh), authenticated with `gh auth login` or GH_TOKEN / GITHUB_TOKEN
  - Google Chrome or Chromium on PATH (google-chrome or chromium)

Usage:
  python3 scripts/dashboard/render_dashboard.py
  python3 scripts/dashboard/render_dashboard.py --out ./botanical-progress.png
  python3 scripts/dashboard/render_dashboard.py --repo . --github-repo owner/name
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

# Set in main() before any git or GitHub call.
REPO = Path(".")
OUT_PNG = Path("botanical-progress.png")
REPO_SLUG = ""
REF = "origin/main"

TZ = ZoneInfo("Europe/Amsterdam")
# Project epoch. The exclusive end is midnight after today, computed at run time.
RANGE_START = datetime(2026, 9, 23, tzinfo=TZ)
MAX_CHART_DAYS = 14

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
EN = "\u2013"

LOCK_NAMES = {
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lock",
    "bun.lockb",
    "cargo.lock",
    "poetry.lock",
    "pipfile.lock",
    "composer.lock",
    "gemfile.lock",
    "go.sum",
    "packages.lock.json",
    "npm-shrinkwrap.json",
    "deno.lock",
    "uv.lock",
    "flake.lock",
    "pubspec.lock",
    "mix.lock",
    "podfile.lock",
    "cartfile.resolved",
}
BIN_EXT = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".pdf",
    ".zip", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".mp3", ".mp4", ".wav", ".ogg", ".webm", ".mov",
    ".wasm", ".bin", ".exe", ".dll", ".so", ".dylib", ".a", ".o",
    ".pyc", ".class", ".jar", ".lockb", ".sqlite", ".db", ".parquet",
}

# Dark dashboard palette.
BG = "#161616"
CARD = "#1c1c1c"
GRID = "#2a2a2a"
HAIR = "#333333"
TEXT = "#ededed"
MUTED = "#8f8f8f"
GREEN = "#00a678"
RED = "#e45858"
BLUE = "#4fa9f8"
FILL = "#16362c"


def git_env() -> dict[str, str]:
    env = os.environ.copy()
    # Unattended runs must not stop on a credential prompt.
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GCM_INTERACTIVE"] = "Never"
    return env


def git(*args: str, cwd: Path | None = None) -> str:
    return subprocess.check_output(
        ["git", *args], cwd=cwd or REPO, text=True, errors="replace", env=git_env()
    )


def default_repo() -> Path:
    """Git root that contains this script."""
    script_dir = Path(__file__).resolve().parent
    try:
        top = subprocess.check_output(
            ["git", "-C", str(script_dir), "rev-parse", "--show-toplevel"],
            text=True,
            errors="replace",
            env=git_env(),
        ).strip()
    except subprocess.CalledProcessError as exc:
        raise SystemExit(
            "This script is not inside a git checkout. Pass --repo."
        ) from exc
    return Path(top)


def parse_github_slug(url: str) -> str:
    """owner/name from an origin URL. Userinfo is stripped and never printed."""
    cleaned = url.strip()
    if cleaned.endswith(".git"):
        cleaned = cleaned[:-4]
    cleaned = re.sub(r"^[a-z][a-z0-9+.-]*://[^/]*@", "", cleaned, flags=re.IGNORECASE)
    match = re.search(r"github\.com[:/]([^/\s]+)/([^/\s]+)$", cleaned)
    if not match:
        raise SystemExit(
            "Cannot parse owner/name from the origin remote. Pass --github-repo owner/name."
        )
    return f"{match.group(1)}/{match.group(2)}"


def slug_from_origin() -> str:
    try:
        url = git("remote", "get-url", "origin").strip()
    except subprocess.CalledProcessError as exc:
        raise SystemExit(
            "No origin remote. Pass --github-repo owner/name."
        ) from exc
    return parse_github_slug(url)


def prepare_ref() -> str:
    """Fetch origin and choose origin/main, without changing the worktree."""
    probe = subprocess.run(
        ["git", "rev-parse", "--is-inside-work-tree"],
        cwd=REPO,
        text=True,
        capture_output=True,
        env=git_env(),
    )
    if probe.returncode != 0 or probe.stdout.strip() != "true":
        raise SystemExit(f"Not a git checkout: {REPO}")
    subprocess.check_call(["git", "fetch", "--prune", "origin"], cwd=REPO, env=git_env())
    for candidate in ("origin/main", "main"):
        ok = subprocess.run(
            ["git", "rev-parse", "--verify", "--quiet", candidate],
            cwd=REPO,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=git_env(),
        )
        if ok.returncode == 0:
            return candidate
    raise SystemExit("No origin/main or main ref to measure.")


def find_browser() -> str:
    for name in (
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
        "chrome",
    ):
        found = shutil.which(name)
        if found:
            return found
    raise SystemExit(
        "Google Chrome or Chromium is required on PATH (google-chrome or chromium)."
    )


def gh_json(args: list[str]):
    env = os.environ.copy()
    env["GH_FORCE_TTY"] = "0"
    env["NO_COLOR"] = "1"
    raw = subprocess.check_output(["gh", *args], text=True, env=env)
    return json.loads(raw)


def gh_search_count(qualifiers: str) -> int:
    env = os.environ.copy()
    env["GH_FORCE_TTY"] = "0"
    env["NO_COLOR"] = "1"
    search = json.loads(
        subprocess.check_output(
            ["gh", "api", f"search/issues?q=repo:{REPO_SLUG}+{qualifiers}&per_page=1"],
            text=True,
            env=env,
        )
    )
    return int(search.get("total_count", 0))


def window_dates(today: date) -> tuple[date, date]:
    """Inclusive start date and exclusive end date (the day after `today`)."""
    start = RANGE_START.date()
    end = today + timedelta(days=1)
    if end <= start:
        end = start + timedelta(days=1)
    return start, end


def iter_days(start: date, end: date) -> list[str]:
    """Calendar dates in [start, end)."""
    days = []
    d = start
    while d < end:
        days.append(d.isoformat())
        d += timedelta(days=1)
    return days


def at_midnight(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=TZ)


def format_span(start: date, end: date) -> str:
    """Inclusive English date span, e.g. '23–28 Sep 2026'."""
    if start.year == end.year and start.month == end.month:
        if start.day == end.day:
            return f"{start.day} {MONTHS[start.month - 1]} {start.year}"
        return f"{start.day}{EN}{end.day} {MONTHS[start.month - 1]} {start.year}"
    if start.year == end.year:
        return (
            f"{start.day} {MONTHS[start.month - 1]}{EN}{end.day} "
            f"{MONTHS[end.month - 1]} {end.year}"
        )
    return (
        f"{start.day} {MONTHS[start.month - 1]} {start.year}{EN}"
        f"{end.day} {MONTHS[end.month - 1]} {end.year}"
    )


def subtitle_for(all_days: list[str], chart_days: list[str]) -> str:
    prefix = f"{REPO_SLUG} · main branch, pull requests and issues"
    start = date.fromisoformat(all_days[0])
    end = date.fromisoformat(all_days[-1])
    if chart_days == all_days:
        return f"{prefix} · {format_span(start, end)}"
    since = f"{start.day} {MONTHS[start.month - 1]} {start.year}"
    chart_span = format_span(date.fromisoformat(chart_days[0]), date.fromisoformat(chart_days[-1]))
    return f"{prefix} · since {since} · per-day charts {chart_span}"


def norm_path(path: str) -> str:
    p = path
    if " => " in p:
        while "{" in p and " => " in p:
            i = p.rfind("{")
            j = p.find("}", i)
            if i < 0 or j < 0:
                break
            seg = p[i + 1 : j]
            if " => " not in seg:
                break
            p = p[:i] + seg.split(" => ", 1)[1] + p[j + 1 :]
        if " => " in p:
            p = p.split(" => ")[-1].strip()
    return p


def excluded(path: str) -> bool:
    base = os.path.basename(path).lower()
    ext = os.path.splitext(base)[1]
    if base in LOCK_NAMES or base.endswith(".lock") or base.endswith(".lockb"):
        return True
    return ext in BIN_EXT


def parse_numstat(diff: str) -> tuple[int, int]:
    add = dele = 0
    for line in diff.splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        a, d, p = parts[0], parts[1], parts[2]
        if a == "-" or d == "-":
            continue
        if excluded(norm_path(p)):
            continue
        add += int(a)
        dele += int(d)
    return add, dele


def count_head_lines() -> int:
    listing = git("ls-tree", "-r", "--name-only", REF)
    files = [f for f in listing.splitlines() if f and not excluded(f)]
    if not files:
        return 0
    proc = subprocess.Popen(
        ["git", "cat-file", "--batch"],
        cwd=REPO,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        env=git_env(),
    )
    assert proc.stdin and proc.stdout
    proc.stdin.write(("\n".join(f"{REF}:{f}" for f in files) + "\n").encode())
    proc.stdin.close()
    total = 0
    for _ in files:
        header = proc.stdout.readline().decode()
        if not header or header.startswith(" missing"):
            continue
        # <sha> blob <size>
        try:
            size = int(header.rsplit(" ", 1)[1])
        except ValueError:
            continue
        data = proc.stdout.read(size)
        proc.stdout.read(1)  # trailing newline
        if b"\0" in data[:8192]:
            continue
        if not data:
            continue
        total += data.count(b"\n") + (0 if data.endswith(b"\n") else 1)
    proc.wait()
    return total


def collect() -> dict:
    today = datetime.now(TZ).date()
    start_date, end_date = window_dates(today)
    range_start = at_midnight(start_date)
    range_end = at_midnight(end_date)
    all_days = iter_days(start_date, end_date)
    chart_days = all_days[-MAX_CHART_DAYS:]

    empty = subprocess.check_output(
        ["git", "hash-object", "-t", "tree", "/dev/null"], cwd=REPO, text=True, env=git_env()
    ).strip()
    fp = git("rev-list", "--reverse", "--first-parent", REF).split()
    all_shas = git("rev-list", REF).split()

    day_lines_all = {day: {"add": 0, "del": 0} for day in all_days}
    series = []  # first-parent cumulative LOC
    cum = 0
    total_add = total_del = 0
    for sha in fp:
        parents = git("rev-parse", f"{sha}^@").split()
        base = parents[0] if parents else empty
        diff = git("diff", "--numstat", "-M", base, sha)
        add, dele = parse_numstat(diff)
        total_add += add
        total_del += dele
        cum += add - dele
        iso = git("show", "-s", "--format=%cI", sha).strip()
        dt = datetime.fromisoformat(iso).astimezone(TZ)
        series.append({"sha": sha[:7], "dt": dt, "loc": cum, "add": add, "del": dele})
        if range_start <= dt < range_end:
            key = dt.date().isoformat()
            day_lines_all[key]["add"] += add
            day_lines_all[key]["del"] += dele

    head_lines = count_head_lines()
    if head_lines != cum:
        raise SystemExit(
            f"LOC mismatch: first-parent net {cum} != blob line count {head_lines}"
        )

    commits_all = {day: 0 for day in all_days}
    for sha in all_shas:
        iso = git("show", "-s", "--format=%cI", sha).strip()
        dt = datetime.fromisoformat(iso).astimezone(TZ)
        if range_start <= dt < range_end:
            commits_all[dt.date().isoformat()] += 1

    # Rolling 24h from now, not the Amsterdam calendar day. Committer
    # timestamps (%cI), same clock the daily buckets use. Filter the log
    # instead of git --since so the cutoff stays in Europe/Amsterdam.
    now = datetime.now(TZ)
    cutoff = now - timedelta(hours=24)
    commits_24h = 0
    for line in git("log", REF, "--format=%cI").splitlines():
        line = line.strip()
        if not line:
            continue
        dt = datetime.fromisoformat(line).astimezone(TZ)
        if dt >= cutoff:
            commits_24h += 1

    # Cap is high on purpose; the search total below fails the run if it is hit.
    prs = gh_json(
        [
            "pr", "list", "--repo", REPO_SLUG, "--state", "all", "--limit", "1000",
            "--json", "number,state,createdAt,mergedAt,closedAt",
        ]
    )
    pr_search = gh_search_count("is:pr")
    if pr_search != len(prs):
        raise SystemExit(f"PR count mismatch: list={len(prs)} search={pr_search}")

    filed_all = {day: 0 for day in all_days}
    merged_all = {day: 0 for day in all_days}
    open_now = 0
    merged_total = 0
    for pr in prs:
        if pr["state"] == "OPEN":
            open_now += 1
        if pr["state"] == "MERGED":
            merged_total += 1
        created = datetime.fromisoformat(pr["createdAt"].replace("Z", "+00:00")).astimezone(TZ)
        if range_start <= created < range_end:
            filed_all[created.date().isoformat()] += 1
        if pr.get("mergedAt"):
            md = datetime.fromisoformat(pr["mergedAt"].replace("Z", "+00:00")).astimezone(TZ)
            if range_start <= md < range_end:
                merged_all[md.date().isoformat()] += 1

    issues = gh_json(
        [
            "issue", "list", "--repo", REPO_SLUG, "--state", "all", "--limit", "1000",
            "--json", "number,state,createdAt,closedAt",
        ]
    )
    # gh issue list can include PRs; drop anything that is really a pull request.
    pr_numbers = {pr["number"] for pr in prs}
    issues = [i for i in issues if i["number"] not in pr_numbers]
    opened_all = {day: 0 for day in all_days}
    closed_all = {day: 0 for day in all_days}
    issues_total = 0
    issues_closed = 0
    for issue in issues:
        created = datetime.fromisoformat(issue["createdAt"].replace("Z", "+00:00")).astimezone(TZ)
        closed_at = None
        if issue.get("closedAt"):
            closed_at = datetime.fromisoformat(issue["closedAt"].replace("Z", "+00:00")).astimezone(TZ)
        if range_start <= created < range_end:
            opened_all[created.date().isoformat()] += 1
        if closed_at is not None and range_start <= closed_at < range_end:
            closed_all[closed_at.date().isoformat()] += 1
        if created < range_end:
            issues_total += 1
            if issue["state"] == "CLOSED":
                issues_closed += 1

    # Cross-check the search API so a paging quirk cannot hide issues.
    issue_search = gh_search_count("is:issue")
    if issue_search != issues_total:
        raise SystemExit(
            f"Issue count mismatch: list={issues_total} search={issue_search}"
        )

    def slice_days(mapping: dict) -> dict:
        return {day: mapping[day] for day in chart_days}

    generated = datetime.now(TZ)
    return {
        "loc": cum,
        "added": total_add,
        "deleted": total_del,
        "commits": sum(commits_all.values()),
        "commits_24h": commits_24h,
        "prs_merged": merged_total,
        "prs_open": open_now,
        "prs_filed_total": sum(filed_all.values()),
        "issues_closed": issues_closed,
        "issues_total": issues_total,
        "days": chart_days,
        "all_days": all_days,
        "range_start": range_start,
        "range_end": range_end,
        "truncated": chart_days != all_days,
        "subtitle": subtitle_for(all_days, chart_days),
        "day_lines": slice_days(day_lines_all),
        "series": series,
        "commits_per_day": slice_days(commits_all),
        "filed": slice_days(filed_all),
        "merged": slice_days(merged_all),
        "opened": slice_days(opened_all),
        "closed": slice_days(closed_all),
        "generated": generated,
        "head": git("rev-parse", "--short", REF).strip(),
        "head_subject": git("log", "-1", "--format=%s", REF).strip(),
    }


def comma(n: int) -> str:
    return f"{n:,}"


def fmt_delta(n: int) -> str:
    sign = "+" if n > 0 else ("−" if n < 0 else "")
    a = abs(n)
    if a >= 1000:
        text = f"{a / 1000:.1f}"
        if text.endswith(".0") and a >= 10000:
            text = text[:-2]
        return f"{sign}{text}k"
    return f"{sign}{comma(a)}" if sign else "0"


def day_labels(days: list[str], short: bool) -> list[str]:
    out = []
    for day in days:
        dt = date.fromisoformat(day)
        out.append(str(dt.day) if short else f"{WEEKDAYS[dt.weekday()]} {dt.day}")
    return out


def bar_axis(peak: int, designed: int) -> tuple[int, list[int]]:
    """Keep the designed axis until a bar would clip, then double it."""
    if peak <= designed:
        if designed <= 2:
            return designed, list(range(designed + 1))
        return designed, [0, designed // 2, designed]
    top = designed
    while top < peak:
        top *= 2
    if top <= 2:
        return top, list(range(top + 1))
    return top, [0, top // 2, top]


def loc_axis(peak: int) -> tuple[int, list[int]]:
    """0–80k in 20k steps until the curve would leave the plot."""
    top = 80000
    if peak > top:
        grain = 20000
        top = ((peak + grain - 1) // grain) * grain
    step = top // 4
    return top, [0, step, step * 2, step * 3, top]


def tick_indices(n: int, max_ticks: int) -> list[int]:
    if n <= max_ticks:
        return list(range(n))
    step = (n - 1) / (max_ticks - 1)
    idxs = []
    for i in range(max_ticks):
        idx = min(n - 1, max(0, round(i * step)))
        if not idxs or idx != idxs[-1]:
            idxs.append(idx)
    idxs[0] = 0
    idxs[-1] = n - 1
    return idxs


def svg_lines(data: dict) -> str:
    """Diverging daily added/deleted bars. A dominant day is axis-broken."""
    w, h = 582, 214
    left, right, top, bottom = 40, 8, 6, 28
    days = data["days"]
    adds = [data["day_lines"][d]["add"] for d in days]
    dels = [data["day_lines"][d]["del"] for d in days]
    ranked = sorted(adds, reverse=True)
    dominant = ranked[0] > max(16000, (ranked[1] if len(ranked) > 1 else 0) * 2.2)
    max_del = max(dels) if dels else 0
    y_max = 16000
    # Room below zero so the largest deletion label sits above the day names.
    y_min = -4500
    ticks = [15000, 10000, 5000, 0, -4000]
    if max_del > 4000:
        depth = ((max_del + 1499) // 1000) * 1000
        y_min = -float(depth)
        ticks = [15000, 10000, 5000, 0, -depth]
    plot_w = w - left - right
    plot_h = h - top - bottom

    def y(v: float) -> float:
        return top + (y_max - v) / (y_max - y_min) * plot_h

    zero = y(0)
    parts = [f'<svg viewBox="0 0 {w} {h}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">']
    for t in ticks:
        yy = y(t)
        parts.append(f'<line x1="{left}" y1="{yy:.1f}" x2="{w-right}" y2="{yy:.1f}" stroke="{GRID}" stroke-width="1"/>')
        label = "0" if t == 0 else fmt_delta(t).replace("+", "")
        parts.append(
            f'<text x="{left-6}" y="{yy+3:.1f}" text-anchor="end" fill="{MUTED}" font-size="10">{label}</text>'
        )
    parts.append(f'<line x1="{left}" y1="{zero:.1f}" x2="{w-right}" y2="{zero:.1f}" stroke="#3a3a3a" stroke-width="1"/>')
    n = len(days)
    slot = plot_w / n
    bar_w = min(36, slot * 0.46)
    # Which day is the dominant import (largest add)?
    dom_i = max(range(n), key=lambda i: adds[i]) if dominant else -1
    # Weekday labels collide once a bar slot gets narrower than the text.
    labels = day_labels(days, short=n > 10)
    label_rights: list[float] = []
    for i, day in enumerate(days):
        cx = left + slot * i + slot / 2
        add, dele = adds[i], dels[i]
        if add:
            y_top = y(min(add, y_max))
            bh = zero - y_top
            parts.append(
                f'<rect x="{cx-bar_w/2:.1f}" y="{y_top:.1f}" width="{bar_w:.1f}" height="{bh:.1f}" fill="{GREEN}" rx="1"/>'
            )
            if i == dom_i:
                hatch_h = 18
                x0 = cx - bar_w / 2
                parts.append(f'<clipPath id="importcap"><rect x="{x0:.1f}" y="{y_top:.1f}" width="{bar_w:.1f}" height="{hatch_h}"/></clipPath>')
                parts.append('<g clip-path="url(#importcap)">')
                k = -hatch_h
                while k < bar_w + hatch_h:
                    parts.append(
                        f'<line x1="{x0+k:.1f}" y1="{y_top+hatch_h:.1f}" x2="{x0+k+hatch_h:.1f}" y2="{y_top:.1f}" stroke="#ffffff" stroke-opacity="0.55" stroke-width="1.4"/>'
                    )
                    k += 5
                parts.append("</g>")
                # Prefer the left side, matching the original callout. Flip right
                # when the left side would leave the plot (dominant day near the edge).
                callout = fmt_delta(add)
                callout_w = max(70, 6.6 * len(callout) + 8)
                tx_left = x0 - 6
                if tx_left - callout_w >= left:
                    tx, anchor = tx_left, "end"
                else:
                    tx, anchor = x0 + bar_w + 6, "start"
                parts.append(
                    f'<text x="{tx:.1f}" y="{y_top+20:.1f}" text-anchor="{anchor}" fill="{TEXT}" font-size="11" font-weight="650">{callout}</text>'
                )
                parts.append(
                    f'<text x="{tx:.1f}" y="{y_top+33:.1f}" text-anchor="{anchor}" fill="#c8c8c8" font-size="10">initial import</text>'
                )
            else:
                text = fmt_delta(add)
                # Tabular digits at this font are ~6.6px. Skip once neighbours would touch.
                half = 3.3 * len(text)
                if n <= 8 or not any(abs(cx - prev) < half + prev_half + 3 for prev, prev_half in label_rights):
                    parts.append(
                        f'<text x="{cx:.1f}" y="{y_top-4:.1f}" text-anchor="middle" fill="{TEXT}" font-size="10">{text}</text>'
                    )
                    label_rights.append((cx, half))
        if dele:
            y_bot = y(-min(dele, -y_min))
            parts.append(
                f'<rect x="{cx-bar_w/2:.1f}" y="{zero:.1f}" width="{bar_w:.1f}" height="{y_bot-zero:.1f}" fill="{RED}" rx="1"/>'
            )
            label_y = min(y_bot + 11, h - bottom + 8)
            parts.append(
                f'<text x="{cx:.1f}" y="{label_y:.1f}" text-anchor="middle" fill="{RED}" font-size="10">{fmt_delta(-dele)}</text>'
            )
        parts.append(
            f'<text x="{cx:.1f}" y="{h-6}" text-anchor="middle" fill="{MUTED}" font-size="10">{labels[i]}</text>'
        )
    parts.append("</svg>")
    return "".join(parts)


def svg_loc(data: dict) -> str:
    w, h = 360, 214
    left, right, top, bottom = 36, 14, 8, 22
    plot_w = w - left - right
    plot_h = h - top - bottom
    start = data["range_start"]
    end = data["range_end"]
    in_range = [p for p in data["series"] if start <= p["dt"] < end]
    peak = max((p["loc"] for p in in_range), default=0)
    y_max, ticks = loc_axis(peak)
    y_min = 0

    def y(v: float) -> float:
        return top + (y_max - v) / (y_max - y_min) * plot_h

    def x_of(dt: datetime) -> float:
        span = (end - start).total_seconds()
        return left + (dt - start).total_seconds() / span * plot_w

    parts = [f'<svg viewBox="0 0 {w} {h}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">']
    for t in ticks:
        yy = y(t)
        parts.append(f'<line x1="{left}" y1="{yy:.1f}" x2="{w-right}" y2="{yy:.1f}" stroke="{GRID}" stroke-width="1"/>')
        label = "0" if t == 0 else f"{t // 1000}k"
        parts.append(
            f'<text x="{left-6}" y="{yy+3:.1f}" text-anchor="end" fill="{MUTED}" font-size="10">{label}</text>'
        )
    # step path from 0 at window start, hold through window end
    pts = [(start, 0)]
    for point in in_range:
        pts.append((point["dt"], point["loc"]))
    last_loc = pts[-1][1]
    pts.append((end, last_loc))
    step = []
    for i, (dt, loc) in enumerate(pts):
        if i == 0:
            step.append((x_of(dt), y(loc)))
        else:
            step.append((x_of(dt), step[-1][1]))
            step.append((x_of(dt), y(loc)))
    line = " ".join(f"{x:.1f},{yy:.1f}" for x, yy in step)
    base = y(0)
    fill = line + f" {step[-1][0]:.1f},{base:.1f} {step[0][0]:.1f},{base:.1f}"
    parts.append(f'<polygon points="{fill}" fill="{FILL}"/>')
    parts.append(f'<polyline points="{line}" fill="none" stroke="{GREEN}" stroke-width="1.6"/>')
    # dot + label at the last real commit inside the window
    if in_range:
        last = in_range[-1]
        lx, ly = x_of(last["dt"]), y(last["loc"])
        parts.append(f'<circle cx="{lx:.1f}" cy="{ly:.1f}" r="3.2" fill="{GREEN}"/>')
        anchor = "end" if lx > left + plot_w * 0.72 else "start"
        dx = -8 if anchor == "end" else 8
        parts.append(
            f'<text x="{lx+dx:.1f}" y="{ly-6:.1f}" text-anchor="{anchor}" fill="{TEXT}" font-size="11" font-weight="600">{comma(last["loc"])}</text>'
        )
    days = data["all_days"]
    # Six days use a label per day ("Wed 23"). Longer windows thin them out.
    labels = day_labels(days, short=False)
    for i in tick_indices(len(labels), 8 if len(labels) <= 8 else 6):
        cx = left + (i + 0.5) / len(labels) * plot_w
        parts.append(
            f'<text x="{cx:.1f}" y="{h-6}" text-anchor="middle" fill="{MUTED}" font-size="10">{labels[i]}</text>'
        )
    parts.append("</svg>")
    return "".join(parts)


def svg_bars(data: dict, key_values: list[tuple[str, str, dict]], y_max: int, ticks: list[int]) -> str:
    """Single or grouped bars. key_values is [(name, color, day->int)]."""
    w, h = 300, 156
    left, right, top, bottom = 28, 8, 6, 20
    days = data["days"]
    plot_w = w - left - right
    plot_h = h - top - bottom

    def y(v: float) -> float:
        return top + (y_max - v) / y_max * plot_h

    zero = y(0)
    parts = [f'<svg viewBox="0 0 {w} {h}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">']
    for t in ticks:
        yy = y(t)
        parts.append(f'<line x1="{left}" y1="{yy:.1f}" x2="{w-right}" y2="{yy:.1f}" stroke="{GRID}" stroke-width="1"/>')
        parts.append(
            f'<text x="{left-5}" y="{yy+3:.1f}" text-anchor="end" fill="{MUTED}" font-size="10">{t}</text>'
        )
    n = len(days)
    groups = len(key_values)
    slot = plot_w / n
    bar_w = min(18, slot * (0.34 if groups == 1 else 0.28))
    gap = 3 if groups > 1 else 0
    total_w = groups * bar_w + (groups - 1) * gap
    labels = day_labels(days, short=True)
    for i, day in enumerate(days):
        cx = left + slot * i + slot / 2
        start = cx - total_w / 2
        for g, (_name, color, series) in enumerate(key_values):
            val = series[day]
            x = start + g * (bar_w + gap)
            if val:
                yy = y(val)
                parts.append(
                    f'<rect x="{x:.1f}" y="{yy:.1f}" width="{bar_w:.1f}" height="{zero-yy:.1f}" fill="{color}" rx="1"/>'
                )
                text = str(val)
                mid = x + bar_w / 2
                # Six-day bars have room for side-by-side labels. A 14-day
                # grouped chart does not, so stack the series one line apart.
                label_y = yy - 3
                if n > 8 and groups > 1:
                    label_y = yy - 3 - (groups - 1 - g) * 12
                if label_y >= 8:
                    parts.append(
                        f'<text x="{mid:.1f}" y="{label_y:.1f}" text-anchor="middle" fill="{TEXT}" font-size="10">{text}</text>'
                    )
        parts.append(
            f'<text x="{cx:.1f}" y="{h-5}" text-anchor="middle" fill="{MUTED}" font-size="10">{labels[i]}</text>'
        )
    parts.append("</svg>")
    return "".join(parts)


def legend(items: list[tuple[str, str]]) -> str:
    bits = []
    for name, color in items:
        bits.append(
            f'<span class="leg"><i style="background:{color}"></i>{name}</span>'
        )
    return "".join(bits)


def render_html(data: dict) -> str:
    g = data["generated"]
    gen = f"{g.day} {MONTHS[g.month - 1]} {g.year}"
    loc_svg = svg_loc(data)
    lines_svg = svg_lines(data)
    commit_peak = max(data["commits_per_day"].values(), default=0)
    pr_peak = max(
        [0, *data["filed"].values(), *data["merged"].values()]
    )
    issue_peak = max(
        [0, *data["opened"].values(), *data["closed"].values()]
    )
    cmax, cticks = bar_axis(commit_peak, 40)
    pmax, pticks = bar_axis(pr_peak, 20)
    imax, iticks = bar_axis(issue_peak, 2)
    commits_svg = svg_bars(
        data,
        [("Commits", GREEN, data["commits_per_day"])],
        y_max=cmax,
        ticks=cticks,
    )
    pr_svg = svg_bars(
        data,
        [("Filed", BLUE, data["filed"]), ("Merged", GREEN, data["merged"])],
        y_max=pmax,
        ticks=pticks,
    )
    issue_svg = svg_bars(
        data,
        [("Opened", BLUE, data["opened"]), ("Closed", GREEN, data["closed"])],
        y_max=imax,
        ticks=iticks,
    )
    deleted = data["deleted"]
    n24 = data["commits_24h"]
    trend = f"+{n24} in the last 24h"
    # Positive gets the green em; zero stays the muted .s color.
    trend_html = f'<em class="pos">{trend}</em>' if n24 > 0 else trend
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<style>
  * {{ box-sizing: border-box; }}
  html, body {{
    margin: 0; padding: 0; width: 1024px; height: 645px; overflow: hidden;
    background: {BG}; color: {TEXT};
    font-family: Inter, "Helvetica Neue", Arial, sans-serif;
    font-variant-numeric: tabular-nums;
  }}
  .page {{
    width: 1024px; height: 645px;
    padding: 16px 20px 14px;
    display: flex; flex-direction: column; gap: 10px;
  }}
  header {{
    display: flex; justify-content: space-between; align-items: flex-start;
    height: 46px;
  }}
  h1 {{
    margin: 0; font-size: 20px; font-weight: 650; letter-spacing: -0.02em; line-height: 1.15;
  }}
  .sub {{ margin: 3px 0 0; color: {MUTED}; font-size: 11.5px; font-weight: 450; white-space: nowrap; }}
  .gen {{ color: {MUTED}; font-size: 11.5px; padding-top: 4px; white-space: nowrap; }}
  .kpis {{
    height: 100px; background: {CARD}; border-radius: 12px;
    display: grid; grid-template-columns: repeat(5, 1fr);
    border: 1px solid #242424;
  }}
  .kpi {{ padding: 12px 16px 10px; min-width: 0; }}
  .kpi + .kpi {{ box-shadow: inset 1px 0 0 {HAIR}; }}
  .k {{ color: {MUTED}; font-size: 10px; letter-spacing: 0.08em; font-weight: 600; }}
  .v {{ font-size: 28px; font-weight: 640; letter-spacing: -0.03em; line-height: 1.15; margin-top: 2px; }}
  .s {{ color: {MUTED}; font-size: 11.5px; margin-top: 1px; }}
  .s em {{ color: {RED}; font-style: normal; }}
  .s em.pos {{ color: {GREEN}; }}
  .mid {{ flex: 1; display: grid; grid-template-columns: 1.5fr 1fr; gap: 10px; min-height: 0; }}
  .bot {{ height: 196px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }}
  article {{
    background: {CARD}; border-radius: 12px; border: 1px solid #242424;
    padding: 12px 12px 8px; display: flex; flex-direction: column; min-width: 0; min-height: 0;
  }}
  .ct {{ display: flex; justify-content: space-between; align-items: center; gap: 8px; }}
  .ct h2 {{ margin: 0; font-size: 14px; font-weight: 620; letter-spacing: -0.01em; }}
  .hint {{ color: {MUTED}; font-size: 11px; }}
  .leg {{ display: inline-flex; align-items: center; gap: 5px; color: {MUTED}; font-size: 11px; margin-left: 10px; }}
  .leg i {{ width: 8px; height: 8px; border-radius: 2px; display: inline-block; }}
  .chart {{ flex: 1; min-height: 0; }}
</style>
</head>
<body>
<div class="page">
  <header>
    <div>
      <h1>Botanical progress</h1>
      <p class="sub">{data["subtitle"]}</p>
    </div>
    <div class="gen">generated {gen} · Europe/Amsterdam</div>
  </header>
  <section class="kpis">
    <div class="kpi"><div class="k">LINES OF CODE</div><div class="v">{comma(data["loc"])}</div><div class="s">net, excl. binaries &amp; locks</div></div>
    <div class="kpi"><div class="k">LINES CHANGED</div><div class="v">+{comma(data["added"])}</div><div class="s"><em>−{comma(deleted)} deleted</em></div></div>
    <div class="kpi"><div class="k">COMMITS</div><div class="v">{data["commits"]}</div><div class="s">on main</div><div class="s">{trend_html}</div></div>
    <div class="kpi"><div class="k">PULL REQUESTS</div><div class="v">{data["prs_merged"]}</div><div class="s">merged · {data["prs_open"]} open</div></div>
    <div class="kpi"><div class="k">ISSUES</div><div class="v">{data["issues_closed"]}/{data["issues_total"]}</div><div class="s">closed</div></div>
  </section>
  <section class="mid">
    <article>
      <div class="ct"><h2>Lines added &amp; deleted per day</h2><div>{legend([("Added", GREEN), ("Deleted", RED)])}</div></div>
      <div class="chart">{lines_svg}</div>
    </article>
    <article>
      <div class="ct"><h2>Total lines of code</h2><div class="hint">per commit on main</div></div>
      <div class="chart">{loc_svg}</div>
    </article>
  </section>
  <section class="bot">
    <article>
      <div class="ct"><h2>Commits per day</h2></div>
      <div class="chart">{commits_svg}</div>
    </article>
    <article>
      <div class="ct"><h2>Pull requests per day</h2><div>{legend([("Filed", BLUE), ("Merged", GREEN)])}</div></div>
      <div class="chart">{pr_svg}</div>
    </article>
    <article>
      <div class="ct"><h2>Issues per day</h2><div>{legend([("Opened", BLUE), ("Closed", GREEN)])}</div></div>
      <div class="chart">{issue_svg}</div>
    </article>
  </section>
</div>
</body>
</html>
"""


def screenshot(html: Path, png: Path) -> None:
    chrome = find_browser()
    png.parent.mkdir(parents=True, exist_ok=True)
    subprocess.check_call(
        [
            chrome,
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--hide-scrollbars",
            "--force-device-scale-factor=2",
            "--window-size=1024,645",
            f"--screenshot={png}",
            html.as_uri(),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render the Botanical progress dashboard PNG.")
    parser.add_argument(
        "--repo",
        type=Path,
        help="Git checkout to measure. Default: the git root that contains this script.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("botanical-progress.png"),
        help="PNG path. Default: ./botanical-progress.png in the current directory.",
    )
    parser.add_argument(
        "--github-repo",
        help="GitHub owner/name for pull requests and issues. Default: the origin remote.",
    )
    return parser.parse_args()


def main() -> None:
    global REPO, OUT_PNG, REPO_SLUG, REF
    args = parse_args()
    REPO = (args.repo if args.repo is not None else default_repo()).resolve()
    OUT_PNG = args.out if args.out.is_absolute() else Path.cwd() / args.out
    if args.github_repo:
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.github_repo):
            raise SystemExit("--github-repo must look like owner/name")
        REPO_SLUG = args.github_repo
    else:
        REPO_SLUG = slug_from_origin()
    REF = prepare_ref()
    data = collect()
    html_fd, html_name = tempfile.mkstemp(prefix="botanical-dashboard-", suffix=".html")
    os.close(html_fd)
    html_path = Path(html_name)
    try:
        html_path.write_text(render_html(data), encoding="utf-8")
        screenshot(html_path, OUT_PNG)
    finally:
        html_path.unlink(missing_ok=True)
    inclusive_end = (data["range_end"] - timedelta(days=1)).date().isoformat()
    print(f"head {data['head']} {data['head_subject']}")
    print(f"window {data['range_start'].date().isoformat()} .. {inclusive_end} ({len(data['all_days'])} days)")
    print(f"chart_days {data['days'][0]} .. {data['days'][-1]} ({len(data['days'])} days)")
    print(f"truncated {data['truncated']}")
    print(f"subtitle {data['subtitle']}")
    print(f"loc {data['loc']}")
    print(f"added {data['added']}")
    print(f"deleted {data['deleted']}")
    print(f"net {data['added'] - data['deleted']}")
    print(f"commits {data['commits']}")
    print(f"commits_24h {data['commits_24h']}")
    print(f"prs_merged {data['prs_merged']}")
    print(f"prs_open {data['prs_open']}")
    print(f"prs_filed {data['prs_filed_total']}")
    print(f"issues_closed {data['issues_closed']}")
    print(f"issues_total {data['issues_total']}")
    print("days", " ".join(data["days"]))
    print("add", " ".join(str(data["day_lines"][d]["add"]) for d in data["days"]))
    print("del", " ".join(str(data["day_lines"][d]["del"]) for d in data["days"]))
    print("commits_day", " ".join(str(data["commits_per_day"][d]) for d in data["days"]))
    print("filed", " ".join(str(data["filed"][d]) for d in data["days"]))
    print("merged", " ".join(str(data["merged"][d]) for d in data["days"]))
    print("opened", " ".join(str(data["opened"][d]) for d in data["days"]))
    print("closed", " ".join(str(data["closed"][d]) for d in data["days"]))
    print("series")
    for point in data["series"]:
        print(f"  {point['dt'].isoformat()} {point['sha']} loc {point['loc']} +{point['add']} -{point['del']}")
    print(f"png {OUT_PNG} bytes {OUT_PNG.stat().st_size}")


if __name__ == "__main__":
    main()
