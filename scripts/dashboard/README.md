# Progress dashboard

Renders a PNG of lines of code, commits, pull requests, and issues on `main`.

## Requirements

Python 3.11 or newer. No third-party packages (see `requirements.txt`).

Also on `PATH`:

- `git`
- `gh` (GitHub CLI), signed in with `gh auth login`, or `GH_TOKEN` / `GITHUB_TOKEN` in the environment
- `google-chrome` or `chromium`

The script talks to GitHub only through `gh`. It does not take a token argument.

## Run

From this repository:

```bash
python3 scripts/dashboard/render_dashboard.py
```

| Flag | Default |
|------|---------|
| `--repo` | Git root that contains this script |
| `--out` | `./botanical-progress.png` in the current directory |
| `--github-repo` | `owner/name` parsed from the `origin` remote |

The script fetches `origin` and measures `origin/main`. It does not switch branches or change the worktree.

Dates use Europe/Amsterdam. The chart window starts on 23 Sep 2026. Stat cards and the total-lines chart cover the whole window. After 14 days, the per-day charts show the last 14 days.

Line counts use first-parent diffs on `main` and skip lockfiles and binaries. Commit counts include every commit reachable from `main`.
