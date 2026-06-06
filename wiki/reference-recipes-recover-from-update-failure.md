---
generated: true
source: 'docs/REFERENCE/recipes/recover-from-update-failure.md'
source_sha: '3845b893094fb13ac9226d8e5c14e79b023b5108'
last_updated: '2026-06-06'
---

# Recipe: Recovering from an arbiter Update Failure

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/recipes/recover-from-update-failure.md](../docs/REFERENCE/recipes/recover-from-update-failure.md)

# Recipe: Recovering from an arbiter Update Failure

**Issue:** #650

## Context

`arbiter update` rewrites generated files (AGENTS.md, .claude/settings.json, hook scripts). If it fails mid-flight — network drop, disk full, process kill — the project may be left in a partially updated state. This recipe documents recovery paths.

## Step 1: Check What Changed

```bash
git status --short
```

Look for partially written files (truncated content) or files that changed unexpectedly.

```bash
git diff HEAD
```

## Step 2: Use Backups (L9 — `.arbiter-generated.json.bak.*`)

**Status (2026-05-16):** Automatic backup files (`.arbiter-generated.json.bak.*`) ship in L9. If your arbiter version predates L9, skip to Step 3 (git rollback).

When L9 ships, arbiter creates timestamped backup files before any update:

```
.arbiter-generated.json.bak.20260516-120000
```

To restore from backup:

```bash
# List available backups
ls .arbiter-generated.json.bak.*

# Restore the most recent backup
cp .arbiter-generated.json.bak.20260516-120000 .arbiter-generated.json

# Re-run update from the restored state
arbiter update
```

## Step 3: `arbiter doctor --repair-state`

**Status (2026-05-16):** `arbiter doctor --repair-state` ships in L9 (#?). If your version predates L9, skip to Step 4.

When L9 ships:

```bash
arbiter doctor --repair-state
```

This command:

- Reads `.arbiter-generated.json` (or the latest backup)
- Compares it against the current state of generated files
- Offers to re-write any file that is missing or truncated
- Does NOT overwrite files that differ due to manual edits (it prompts)

Flags:

- `--dry-run`: show what would be repaired without writing
- `--force`: overwrite all generated files without prompting

## Step 4: Git-Side Rollback

If the partially updated files were already committed, roll back with git:

```bash
# Identify the last clean commit
git log --oneline -10

# Reset to the last clean commit (working tree only — staged changes lost)
git restore --source=<commit-sha> -- AGENTS.md .claude/settings.json

# Or reset the whole project to last clean commit
git reset --hard <commit-sha>
```

**Warning:** `git reset --hard` discards all uncommitted changes. Stash or back up anything you want to keep.

If the bad commit is already pushed:

```bash
# Create a revert commit (safe for shared branches)
git revert <bad-commit-sha>
git push
```

## Step 5: Re-run Update

After restoring a clean state:

```bash
arbiter update
```

Monitor for the same failure. If it recurs, check:

- Disk space: `df -h`
- Permissions on `.arbiter/` and `.claude/`: `ls -la`
- Node.js version: `node --version` (arbiter requires >= 22)

## Step 6: Filing an Issue

If `arbiter doctor` and git rollback cannot fix the state, file a bug report:

1. Run `arbiter report` to generate a bug-report bundle (ships in M5 / #639).

   **Status (2026-05-16):** `arbiter report` ships in M5 (#639). Until then, collect:
   - Output of `arbiter doctor`
   - `git status --short` and `git diff HEAD`
   - The Run ID from the error footer (`Run ID: arb-…`)
   - Node.js and arbiter versions

2. Open a GitHub issue using the [Bug Report template](https://github.com/your-org/arbiter/issues/new?template=bug-report.yml).

3. Include the Run ID in the "Run ID" field — maintainers can correlate it with internal logs.

## Gotchas

- Do not re-run `arbiter update` on a partially written state without first checking `git status`. Running update on a corrupt `.arbiter-generated.json` may produce incorrect output.
- If `.claude/settings.json` is corrupted, Claude Code hooks will stop firing. Verify hook wiring with `arbiter doctor` after any recovery.
- Backup files are gitignored by default. Do not commit them — they may contain absolute paths specific to your local environment.
