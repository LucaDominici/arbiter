---
generated: true
source: 'docs/DEVELOPMENT/CONFORMANCE.md'
source_sha: '4d841d844c694775200af2710d611fd1f7875118'
last_updated: '2026-07-03'
---

# arbiter — Conformance Scorecard

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/DEVELOPMENT/CONFORMANCE.md](../docs/DEVELOPMENT/CONFORMANCE.md)

# arbiter conformance scorecard (#1369)

> `arbiter conformance` — scores a project against the arbiter gold standard and emits a
> per-dimension matrix (pass / partial / fail / skip + evidence ref).

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

## Usage

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

## Implementation

- **`src/commands/conformance.ts`** — `runConformance()` entry point + types
- **`src/conformance/dimensions.ts`** — per-dimension probe functions (pure, testable)
- **`src/conformance/render.ts`** — terminal + JSON rendering helpers
- **`__tests__/commands/conformance.test.ts`** — 15 unit tests

---

## Follow-up scope (not in v1)

The following are deferred to follow-up issues:

- INV-NN for each dimension (machine enforcement in the gate)
- Integration with `gold-audit.mjs` (registry-driven YAML checks)
- `--output <file>` flag to write the report to a markdown file
- Detailed spec for `D-DONE-EVIDENCE` reality-contact criteria (awaiting Luca's spec)
- Additional discipline dimensions: gate green, coverage, invariants, no overclaim,
  docs convention (queued feature #1 in the issue)

## See Also

- [[system-canon]] — related
