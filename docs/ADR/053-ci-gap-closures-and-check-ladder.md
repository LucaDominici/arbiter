---
title: 'ADR-053: CI Gap Closures, Per-Tier Nightly, Opt-In Selective Gates, and Local Provenance Log'
doc_version: '1.0.0'
status: active
last_review: '2026-05-28'
owner: ''
canonical_id: '053'
tags: ['audience/dev', 'kind/adr']
related:
  ['docs/ADR/050-pipeline-complexity-tiers.md', 'docs/ADR/051-collaboration-mode-workflow-axis.md']
---

# ADR-053 — CI Gap Closures, Per-Tier Nightly, Opt-In Selective Gates, and Local Provenance Log

**Status:** Accepted  
**Date:** 2026-05-28  
**Issues:** #1083  
**Supersedes:** —  
**Related:** ADR-050, ADR-051, ADR-052

---

## Context

Arbiter's generated CI tier set had four documented gaps as of 2026-05:

1. **Missing security workflows**: no OSSF Scorecard, no CodeQL/SAST, no dependency-review.
2. **No per-tier nightly differentiation**: `trunk-solo` projects got either no nightly or the full L3+-only industrial nightly, with nothing in between.
3. **No opt-in selective gating**: every `check-all.mjs` run re-runs every check, even when only documentation changed.
4. **No local provenance log**: gate pass/fail results were ephemeral (only `gate-pass.json` written at pass; no append-only history for replay debugging or `arbiter doctor` inspection).

---

## Decision

### 1. New CI gap workflow templates (ADR-053, CANON-18)

| Template                      | Slot    | Emitted when                                       |
| ----------------------------- | ------- | -------------------------------------------------- |
| `06-nightly-lite.yml.ejs`     | 06-lite | `collaborationMode === 'trunk-solo'` + L2+         |
| `15-codeql.yml.ejs`           | 15      | `peer-review` + L2+, or `gated-review` (any level) |
| `16-frontend-quality.yml.ejs` | 16      | non-trunk-solo + L2+ + web archetype               |
| `17-ossf-scorecard.yml.ejs`   | 17      | `gated-review` + L3+                               |

**Slot 11 conflict resolved**: `11-k6-on-demand.yml.ejs` already occupied slot 11; OSSF Scorecard uses slot 17.

### 2. Per-tier nightly

- **trunk-solo** gets `06-nightly-lite.yml` — integration tests + CVE refresh only; no mutation, no SLSA, no SBOM. Light enough to run nightly without significant billing.
- **peer-review** and **gated-review** continue to use `06-nightly.yml` (full mutation + DAST + dep-CVE) at L3+.

### 3. Opt-in selective gating (`--selective`)

`scripts/check-all.mjs` exports `computeSkipped(changedFiles, registry, blacklist)` — a pure function that maps a changed-file list to a Set of check names that can be safely skipped.

**Safety guarantees:**

- CI (`process.env.CI`) always runs full gate regardless of `--selective` flag.
- Inputs with absolute paths, `../` escape sequences, or > 500 files trigger full gate (fail-safe).
- `scripts/lib/full-gate-blacklist.mjs` lists cross-cutting paths (`tsconfig*.json`, `package.json`, `src/utils/**`, `src/templates/**`, `src/generators/**`, etc.) that force full gate when changed.
- Checks not in `scripts/lib/check-registry.mjs` are **never skipped** (fail-safe default for unregistered checks).

**Selective gating is opt-in only.** It is never the default. This is deliberately conservative: glob-based analysis cannot model import-graph dependencies. Use only for confirmed-isolated edits (e.g., docs-only changes).

### 4. Local provenance log (`gate-pass.jsonl`)

`scripts/gate-pass-log.mjs` appends a JSONL record to `.arbiter/gate-pass.jsonl` after each successful gate pass:

```json
{
  "sha": "abc1234...",
  "level": "gate",
  "checks": [],
  "signedAt": "2026-05-28T10:00:00Z",
  "signer": "username"
}
```

**This is supplemental.** `gate-pass.json` (singular) is unchanged and continues to be read by `enforce-gate-before-pr.mjs`. The `.jsonl` file is for `arbiter doctor` inspection and replay debugging only.

**CI does NOT verify `gate-pass.jsonl` for skip decisions.** The token is local provenance, not a trust handoff. CI re-runs everything.

Cosign sign-blob is attempted as a best-effort annotation (fail-open: `FAIL-OPEN-INTENT:` prefix on error). Two independent error boundaries ensure a cosign failure or I/O error never blocks the gate.

`arbiter doctor health` displays the last 5 entries when the file exists; emits WARN when absent.

---

## Consequences

### Positive

- Projects at `gated-review` + L3+ now automatically get OSSF Scorecard and CodeQL on first `arbiter init` (zero configuration).
- `trunk-solo` projects get a lightweight nightly instead of nothing, closing the "no nightly ever" gap for solo developers.
- `computeSkipped` is a pure, tested function with well-defined safety boundaries. Selective gating cannot silently downgrade security checks.
- `arbiter doctor health` now shows gate history, surfacing stale or missing gate runs immediately.

### Negative / Trade-offs

- OSSF Scorecard SHA pin (`ossf/scorecard-action`) will need periodic refresh via Dependabot.
- `computeSkipped` depends on `minimatch` (already in devDependencies). The registry and blacklist must be kept in sync with actual check names manually.
- `gate-pass.jsonl` grows unboundedly. No rotation is implemented (out of scope for this ADR). Users should monitor `.arbiter/` size.

---

## Alternatives considered

**CodeQL in slot 11:** Rejected — `11-k6-on-demand.yml.ejs` already occupies slot 11. Renaming existing templates is a breaking change for projects already using arbiter.

**Automatic selective gating (default on):** Rejected by red-team review. Glob-based analysis is unsound for cross-cutting changes. Import-graph-level selective execution (nx, Bazel) is out of scope.

**CI short-circuit via gate-pass token:** Rejected as theater (from red-team review of original plan). Keyless OIDC signs with the dev's own identity; the dev controls both the signing identity and the check registry. CI verifying that token is "trust the prover to grade their own work". Token kept as local provenance only.

---

## References

- [OSSF Scorecard](https://github.com/ossf/scorecard)
- [CodeQL Action](https://github.com/github/codeql-action)
- [GitHub dependency-review-action](https://github.com/actions/dependency-review-action)
- [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci)
- [axe-core CLI](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/cli)
- ADR-050 §54-58: nightly/weekly/monthly/heartbeat are L3+ only
- ADR-051: collaboration-mode axis driving `collaborationMode` field
- `docs/SYSTEM/CI-TIER-MODEL.md`: the cadence × governance model that classifies the gap
  workflows added here (06-nightly-lite, 15-codeql, 16-frontend-quality, 17-ossf-scorecard)
  into cadence buckets — overlay only, the emit predicates are unchanged (#1502).
