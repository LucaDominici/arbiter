# Runbook — Dependabot PR Triage

## Background

Dependabot opens two types of PRs:

| Type             | Ecosystem   | Auto-EJS sync         | INV-74 label | Notes                    |
| ---------------- | ----------- | --------------------- | ------------ | ------------------------ |
| `npm_and_yarn`   | npm deps    | N/A                   | required     | Standard dependency bump |
| `github_actions` | action pins | **auto** via workflow | required     | See below                |

## github_actions PRs (#905–#908 pattern)

### What happens automatically

1. Dependabot opens PR bumping `.github/workflows/*.yml` action pin.
2. `dependabot-actions-sync.yml` workflow triggers on `pull_request` → detects EJS drift → commits `chore(deps): sync EJS templates with action bumps [skip-docs]` back to PR branch.
3. CI re-triggers on the new commit → parity test passes → Unit Tests + Tech Debt Gates green.

### What still requires human action

4. A human must add label `approved-by-human` to satisfy **INV-74** before merge.
   ```
   gh pr edit <NNN> --add-label approved-by-human
   ```

### Fallback if auto-sync doesn't trigger

If the auto-sync workflow doesn't fire (e.g., token scope issue on self-hosted runner):

```bash
# Checkout the dependabot branch locally
gh pr checkout <NNN>

# Run the sync
node scripts/sync-action-pins.mjs

# Verify
node scripts/sync-action-pins.mjs --check

# Commit and push
git add src/templates/github/workflows/
git commit -m "chore(deps): sync EJS templates with action bumps [skip-docs]"
git push
```

### Rebasing stale dependabot PRs

If dependabot PRs opened before the auto-sync workflow was merged:

```bash
# Rebase each onto main to trigger the new workflow
gh pr update-branch 905
gh pr update-branch 906
gh pr update-branch 907
gh pr update-branch 908
```

Then verify CI goes green, add `approved-by-human` label, merge.

## Merging multiple dependabot github-actions PRs

Each action bump is a separate PR. Merge them in order. After each merge, remaining PRs may need rebase:

```bash
gh pr list --author app/dependabot --label ci
```

## Human-side action pin bumps (edit EJS first)

If a human bumps an EJS template pin first (the preferred SSOT-first direction):

```bash
# After editing src/templates/github/workflows/*.yml.ejs
node scripts/sync-action-pins.mjs --reverse  # propagates EJS → yml
node scripts/sync-action-pins.mjs --check    # verify in sync
```

## Gate check

```bash
node scripts/sync-action-pins.mjs --check   # standalone: exit 1 on drift
node scripts/check-all.mjs L1               # full gate including parity check
```

See ADR-051 in `docs/SYSTEM/DECISIONS.md` for the full design decision.
