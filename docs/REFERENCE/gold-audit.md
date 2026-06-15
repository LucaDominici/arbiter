---
title: 'Reference: Gold-Audit Engine'
doc_version: '1.0.0'
status: active
last_review: '2026-06-15'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# Reference: Gold-Audit Engine

The **gold-audit engine** grades a repo against a per-stack registry and emits a per-check
verdict with evidence plus an aggregate score. It is the native-node reimplementation of an
upstream reference gold-audit engine — **zero Python dependency** for consumer projects. **The
score is computed by code, never by an AI**: the same repo and registry always produce
byte-identical output.

## Artifacts

| File                             | Role                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `standards/gold-registry.yml`    | The registry: every check, its dimension, type, args, weight, risk, anchor.  |
| `standards/gold-profile`         | Per-repo overlays that switch on `applies_if`-gated checks (optional).       |
| `scripts/gold-audit.mjs`         | The engine CLI (verdicts, score, no-regress gate, ratchet, false-gap gate).  |
| `scripts/lib/gold-audit-lib.mjs` | The pure deterministic evaluator (shared by the CLI, the report, and tests). |
| `.gold-audit-baseline.json`      | The monotonic ratchet baseline (score + Y-count, never lowered).             |

## Verdicts

Every check resolves to exactly one verdict, with evidence (file + line) attached:

- **Y** — verified true by code.
- **P** — partial (a `count_matches` check met some, not all, of its target).
- **N** — verified false by code (the path/pattern was absent).
- **NA** — not applicable (`applies_if` overlay disabled).
- **NV** — not verified by code (a `manual` / attestation-required check).

Scoring excludes `NA` and `NV` from the denominator — a repo is never graded on what code
cannot verify.

## Check types

`file_exists`, `file_contains`, `count_matches`, `value`, `manual`. Each non-manual check's
`args.path` is resolved **inside** the repo root; traversal (`..`) and absolute paths are
rejected and scored `N`.

## Dimensions

`D-DOCS`, `D-EFFECTIVENESS` (anti-ceremony: prove tools are wired, not just present),
`D-ENFORCEMENT` (E1–E7), `D-SUPPLY-CHAIN` (keyless signing + SBOM attestation), `D-META-TEST`
(RED-on-bug + GREEN-on-clean per static rule).

## Gates

- **No-regress** (`--check`): recompute and fail if `score` or `yCount` dropped below the
  baseline. A missing baseline bootstraps and passes. `ALLOW_GOLD_REGRESS=1` is the loud,
  session-scoped escape hatch.
- **Ratchet** (`--update-baseline`): per-field `max(current, baseline)` — the baseline can only
  tighten, never loosen.
- **False-gap meta-gate** (`--strict`): if any check is `RISKY`, the gate fails — the engine
  refuses to score on a fragile registry.

## Usage

```bash
node scripts/gold-audit.mjs                  # one-line summary
node scripts/gold-audit.mjs --json           # machine-readable scored payload
node scripts/gold-audit.mjs --check          # no-regress gate (exit 1 on score/Y drop)
node scripts/gold-audit.mjs --strict         # false-gap meta-gate (exit 1 if any RISKY)
node scripts/gold-audit.mjs --update-baseline# monotonic ratchet
```

npm alias: `npm run gold:audit`. Wired into `scripts/check-all.mjs` (the `gold-audit no-regress`
and `gold-audit false-gap` checks, L1) and mirrored in the local↔CI parity map. The engine's
score and dimension table render into `GOLD-REPORT.md` via `scripts/gold-report.mjs`.

## Exit codes

`0` pass/advisory · `1` failure (regression / RISKY / stale) · `2` IO error.
