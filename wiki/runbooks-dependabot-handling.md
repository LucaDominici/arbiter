---
generated: true
source: 'docs/runbooks/dependabot-handling.md'
source_sha: 'c9dda3453d7222cab976b52cd6fe0131a363ee0d'
last_updated: '2026-07-03'
---

# Runbook — Dependabot PR Triage

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/runbooks/dependabot-handling.md](../docs/runbooks/dependabot-handling.md)

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

## Vulnerability triage notes (2026-05-20)

When a Dependabot security alert lands on a transitive dep that arbiter
cannot easily override, document the rationale here and proceed.

### Ecosystem-locked vite / esbuild via vitepress (#976)

vitepress 1.6.4 (current latest) bundles its own `vite@5.x` and `esbuild@0.21.x`.
Forcing `vite@6+` via `overrides` breaks vitepress; forcing `esbuild@0.28+`
breaks minimatch ESM imports used by arbiter's pre-edit hooks.

Mitigations available:

- Wait for vitepress 2.x (supports vite 6 / 7), then re-apply overrides.
- vite/esbuild dev-server CVEs are dev-only — the published static site is
  unaffected.

When vitepress 2 ships, run the dep bump as a single PR with full audit + L2.

## Ubuntu-latest gitleaks install (#987)

GitHub-hosted ubuntu-latest does not allow writes to /usr/local/bin without sudo. Install to RUNNER_TEMP/bin and add to GITHUB_PATH.

## evidence-writer.sh shebang (#991)

evidence-writer.sh.ejs uses bash (not POSIX sh) for portable JSON-escape via parameter expansion. awk gsub varies across mawk/gawk/busybox-awk on self-hosted Docker images.
