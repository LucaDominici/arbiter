---
title: 'CI Migration Guide'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/method']
related: []
---

# CI Migration Guide

> Operational runbook for cutover to the T1 aggregator required-checks model.
> Part of the CI Tabula-Rasa epic (#862).

---

## Branch Protection

arbiter's main branch uses GitHub branch protection to enforce required CI checks before merge.
The configuration is managed via `scripts/apply-branch-protection.mjs` — an idempotent script
that sets the `PUT /repos/{owner}/{repo}/branches/{branch}/protection` payload.

### Required checks

| GitHub check name                  | Job ID                    | Source                           | Purpose                                                |
| ---------------------------------- | ------------------------- | -------------------------------- | ------------------------------------------------------ |
| `CI Required`                      | `ci-required`             | `01-pr-fast.yml` (T1 aggregator) | All fast-CI jobs must pass before merge                |
| `Human Approval Required (INV-74)` | `human-approval-required` | `01-pr-fast.yml` (INV-74)        | Anti-bot gate: PR must carry `approved-by-human` label |

> Note: GitHub branch protection `contexts` must use the **job `name:` field** (the GitHub check run
> name), not the YAML job ID. Verified via
> `gh api repos/LucaDominici/arbiter/commits/main/check-runs --jq '.check_runs[].name'`.

### How to apply

Requires `gh` CLI authenticated with a token that has `repo` admin scope.

```bash
# 1. Export admin token
export GH_TOKEN=<your-admin-token>

# 2. Dry-run first (safe, no API call)
node scripts/apply-branch-protection.mjs --repo LucaDominici/arbiter --dry-run

# 3. Apply
node scripts/apply-branch-protection.mjs --repo LucaDominici/arbiter
```

The script auto-detects the repository from `GITHUB_REPOSITORY` env or `gh repo view` if
`--repo` is omitted.

### Rollback

Before applying protection, capture a snapshot of the current state:

```bash
node scripts/apply-branch-protection.mjs \
  --repo LucaDominici/arbiter \
  --snapshot docs/SYSTEM/branch-protection-snapshot-pre-tier.json
```

To restore, re-apply the snapshot payload manually via `gh api`:

```bash
gh api repos/LucaDominici/arbiter/branches/main/protection \
  --method PUT \
  --input docs/SYSTEM/branch-protection-snapshot-pre-tier.json
```

### Script reference

```
Usage: node scripts/apply-branch-protection.mjs [options]

Options:
  --repo <owner/repo>   Target repository (default: GITHUB_REPOSITORY env or gh auto-detect)
  --branch <name>       Branch to protect (default: main)
  --dry-run             Preview PUT body without calling API
  --json                Dry-run only: emit raw JSON body to stdout
  --snapshot <path>     Write pre-change protection snapshot to this file

Exit codes (INV-53):
  0  PASS  — protection applied (or dry-run complete)
  1  FAIL  — API call failed
  2  ERROR — bad arguments or missing required inputs
```

---

## Phase C5 Cutover (initial state: no required checks)

As of 2026-05-18 the arbiter repo had no required status checks set
(`gh api repos/LucaDominici/arbiter/branches/main/protection/required_status_checks` → 404).

Since the initial state was empty, the cutover simplified to a single add step:

1. Snapshot pre-change state (empty → snapshot records null protection).
2. Apply: `node scripts/apply-branch-protection.mjs --repo LucaDominici/arbiter`.
3. Open a no-op PR to verify `ci-required` and `human-approval-required` show as required checks.
4. Merge after both checks are green.

No old-check removal step needed (there were none to remove).

### Refs

- Epic: #862 (CI Tabula-Rasa)
- Phase C5 issue: #868
- Workflow defining `ci-required` and `human-approval-required`: `.github/workflows/01-pr-fast.yml`
- Tier model design: `docs/SYSTEM/CI-TIER-MODEL.md`
