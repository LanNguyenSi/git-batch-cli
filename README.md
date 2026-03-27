# git-batch-cli

CLI for running safe batch operations across all Git repositories directly below a folder.

Repository: `https://github.com/LanNguyenSi/git-batch-cli`

## What It Does

- scans the current level or a custom root folder
- detects direct child folders that contain `.git`
- checks local repository state before syncing
- switches to a protected branch
- runs `git pull --ff-only origin <branch>`

Default `sync` flow:

1. `git fetch --all --prune`
2. detect the protected target branch
3. switch to that branch if the worktree is clean
4. run `git pull --ff-only`

Dirty repositories are skipped by default.

If you pass `--protected`, that explicit branch order takes precedence over `origin/HEAD`.

## Local Installation

```bash
cd /home/lan/git/pandora/git-batch-cli
npm link
```

After that, the `git-batch` command is available in your shell.

## CI

The repository includes a GitHub Actions workflow at `.github/workflows/ci.yml`.

It currently validates:

- the Node.js test suite on Node 20 and 22
- the publish payload via `npm pack --dry-run`

## Commands

### `sync`

Checks all repositories on one level, skips dirty repositories by default, switches to the protected branch, and pulls with fast-forward only.

```bash
git-batch sync ~/git
git-batch sync /home/lan/git/pandora
git-batch sync ~/git --only api,worker
git-batch sync --protected main,develop --dry-run
```

### `status`

Shows the current branch, detected target branch, and change counters for every repository.

```bash
git-batch status ~/git
```

### `dirty`

Shows only repositories that currently have local changes.

```bash
git-batch dirty ~/git
```

### `fetch`

Runs `git fetch --all --prune` for each repository.

```bash
git-batch fetch ~/git
```

### `branches`

Shows the current branch and the detected protected branch for each repository.

```bash
git-batch branches ~/git
```

### `list`

Lists all discovered repositories on the current level.

```bash
git-batch list ~/git
```

## Options

- `--root <path>`: explicitly set the root folder to scan
- `--protected <a,b,c>`: define preferred protected branches
- `--only <a,b,c>`: include only matching repository names
- `--exclude <a,b,c>`: exclude matching repository names
- `--include-current`: include the current folder if it is a Git repository itself
- `--include-hidden`: scan hidden child directories as well
- `--include-dirty`: allow `sync` to continue even when a repository has local changes
- `--strict`: return a non-zero exit code for actionable problem states
- `--dry-run`: print planned Git commands without executing them
- `--json`: emit JSON instead of plain text

## Repository Filters

`--only` and `--exclude` apply to all commands.

- plain values are treated as case-insensitive substring matches
- regex literals are supported in JavaScript form, for example `'/^api-/'`
- multiple patterns are comma-separated

Examples:

```bash
git-batch status ~/git --only api,worker
git-batch dirty ~/git --exclude legacy,archive
git-batch sync ~/git --only '/^(api|web)-/' --exclude '/-sandbox$/'
```

## Branch Detection

Target branch detection uses this order:

1. explicit `--protected` order, if provided
2. `origin/HEAD`
3. first matching branch from `main, master, develop, dev, staging, production, trunk`

## Output Model

The CLI reports, per repository:

- current branch
- detected target branch
- whether the worktree is clean
- counts for `staged`, `unstaged`, and `untracked`

This makes it easier to spot repositories that would be skipped by `sync`.

## Agent and Automation Use

The CLI is safe for non-interactive use and keeps repository ordering deterministic.

For agents and CI jobs, prefer:

```bash
git-batch status /path/to/workspace --json --strict
git-batch dirty /path/to/workspace --json --strict
git-batch sync /path/to/workspace --json --strict --dry-run
```

Why this works well:

- `--json` returns structured output with `command`, `root`, `repoCount`, `exitCode`, and `results`
- `--strict` turns actionable states into a non-zero exit code
- no interactive prompts are required
- output order is stable because repositories are sorted by name

Recommended interpretation:

- `status --json --strict`: fail if any repository is dirty
- `dirty --json --strict`: fail if any repository has local changes
- `sync --json --strict`: fail if any repository is skipped or errors

## Open Source Files

This repository includes the usual project governance files:

- `LICENSE`
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`

## Suggested Next Steps

- add support for a workspace config file such as `.git-batch.json`
- add optional parallel fetch/pull execution with a configurable concurrency limit
- add an optional confirmation prompt before batch `sync` without `--dry-run`

## Development

```bash
npm test
```
