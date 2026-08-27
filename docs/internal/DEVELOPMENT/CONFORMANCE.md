---
title: 'arbiter — Conformance Scorecard'
doc_version: '1.0.0'
status: active
last_review: '2026-08-26'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/spec']
related: ['docs/internal/SYSTEM/CANON.md']
---

# arbiter conformance scorecard (#1369)

> `arbiter conformance` — scores a project against the arbiter gold standard and emits a
> per-dimension matrix (pass / partial / fail / skip + evidence ref).

> **Status:** this is a proposed command interface, not a registered current CLI
> command. The shipped related surface is `arbiter doctor --prove-gates`, which
> runs negative proofs for the tier-1 conformance dimensions.

---

## Design principles

1. **Code-computed, never AI-scored.** Identical repo state → identical result.
2. **Fail-safe.** Every IO error is caught; the probe returns `fail` with an error detail rather
   than crashing.
3. **Skip over ban.** A dimension that is not applicable for a given project (e.g.
   `D-FE-RENDER-GATE` when archetype is `backend-web-db`) returns `skip`, not `fail`. Skip is
   excluded from the denominator when computing the aggregate score.

---

## Dimensions

| ID               | Title                                      | Pass condition                                                                       |
| ---------------- | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| D-TEST-LEVELS    | Declared test levels populated             | `test-pyramid.json` present; every `status:required` level has ≥1 matching test file |
| D-LIVE-E2E       | Non-mocked live API e2e layer exists       | `*.e2e.ts` or `e2e/**/*.ts` files found in the repo tree                             |
| D-FE-RENDER-GATE | FE archetypes have behavioural/visual gate | playwright/vitest-browser/chromatic config found (skip when archetype is non-FE)     |
| D-DOMAIN-API     | Domain↔API surface completeness checked    | OpenAPI spec file or Pact config found                                               |
| D-DONE-EVIDENCE  | Done-evidence requires reality-contact     | `.arbiter/evidence/` directory exists and contains evidence files                    |

---

## Verdict scale

| Verdict   | Meaning                               | Score weight              |
| --------- | ------------------------------------- | ------------------------- |
| `pass`    | Requirement met, evidence found       | 1.0                       |
| `partial` | Some evidence, requirement partly met | 0.5                       |
| `fail`    | No evidence or requirement not met    | 0                         |
| `skip`    | Dimension not applicable              | excluded from denominator |

---

## Exit codes

| Code | Condition                                                           |
| ---- | ------------------------------------------------------------------- |
| 0    | All applicable dimensions `pass` or `skip`                          |
| 1    | ≥1 dimension `fail` (or `partial` with `--fail-on partial`)         |
| 0    | Project has no `arbiter.json` (not a governed project — all `skip`) |

---

## Proposed usage (not a current CLI command)

```bash
# Score current project (text output)
arbiter conformance

# Score a specific project root
arbiter conformance --dir /path/to/project

# Machine-readable JSON
arbiter conformance --json

# Stricter: exit 1 on partial too
arbiter conformance --fail-on partial
```

---

## Implemented building blocks

- **`src/conformance/engine.ts`** — deterministic scorecard evaluator; it is
  not currently exposed as `arbiter conformance`.
- **`src/conformance/dimensions.ts`** — per-dimension probe functions.
- **`src/conformance/gate-proofs.ts`** — negative-proof registry for tier-1
  conformance dimensions.
- **`src/commands/doctor/prove-gates.ts`** — implementation of the current
  `arbiter doctor --prove-gates` surface.
- **`__tests__/conformance/engine.test.ts`** and
  **`__tests__/commands/doctor-prove-gates.test.ts`** — direct coverage of the
  evaluator and current command.

---

## Follow-up scope (not in v1)

The following are deferred to follow-up issues:

- INV-NN for each dimension (machine enforcement in the gate)
- Integration with `gold-audit.mjs` (registry-driven YAML checks)
- `--output <file>` flag to write the report to a markdown file
- Detailed spec for `D-DONE-EVIDENCE` reality-contact criteria (awaiting Luca's spec)
- Additional discipline dimensions: gate green, coverage, invariants, no overclaim,
  docs convention (queued feature #1 in the issue)
