---
generated: true
source: 'docs/plans/planning-skeleton-migration-plan.md'
source_sha: 'c1781b0bc45da36900a0fed661998c925b4cb391'
last_updated: '2026-06-07'
---

# Planning Skeleton Migration Plan

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/plans/planning-skeleton-migration-plan.md](../docs/plans/planning-skeleton-migration-plan.md)

# Planning Skeleton Migration Plan

> Executable playbook for importing and rationalizing patterns from `internal-ref`
> into arbiter across dual tracks (A: arbiter-for-itself; B: arbiter-as-framework).

---

## Hard Constraints

- Do NOT blindly copy planning artifacts — extract patterns, redesign cleanly
- Do NOT leak Java/Spring assumptions into arbiter core
- Every new doc/script must be referenced, callable, and smoke-tested
- Issue-backed work; no hidden TODOs
- Local↔CI parity is a first-class invariant, not a docstring promise
- INV-73 is violated (zero workflows); each wave must move toward resolution
- KIT source files are REDACTED-origin: reference only (`docs/REFERENCE/external-kit-sources.md`)

---

## Dual-Track Contract

Every wave ships TWO tracks simultaneously:

| Track                        | What it produces                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| **A — arbiter-for-itself**   | Concrete files in the arbiter repo (workflow YAMLs, scripts, hooks, ADRs)           |
| **B — arbiter-as-framework** | B1: EJS template · B2: generator · B3: KIT reference doc · B4: invariant/gate entry |

Not all four B sub-tracks apply to every item. The per-wave matrix below specifies which.

---

## Ossatura Priority Pyramid

```
Foundation:   W1 Listing pass (this wave — DONE)
              W2 KIT canonical SSOT
              W3 Local wrapper + hook parity
              W4 CI tier baseline

Skeleton:     W5 Stack adapter model
Quality:      W6 Anti-drift validator family
              W7 Test taxonomy + evidence schema

Governance:   W8 AI-PR + human-approval + idempotent notify
              W9 Supply chain (Sigstore + SBOM + Trivy)
              W10 Nightly + weekly + heartbeat

Verification: W11 Evidence bundle + final self-validation
```

---

## Wave Summary

### W1 — Listing Pass (CURRENT WAVE, issue #876)

**Track A deliverables (all 10 files):**

| #   | File                                             | Status |
| --- | ------------------------------------------------ | ------ |
| 1   | `docs/audits/kit-canonical-mapping.json`         | DONE   |
| 2   | `docs/audits/planning-skeleton-inventory.json`   | DONE   |
| 3   | `docs/audits/kit-canonical-mapping.md`           | DONE   |
| 4   | `docs/audits/planning-skeleton-audit.md`         | DONE   |
| 5   | `docs/REFERENCE/external-kit-sources.md`         | DONE   |
| 6   | `docs/architecture/skeleton-governance.md`       | DONE   |
| 7   | `docs/architecture/dual-track-contract.md`       | DONE   |
| 8   | `docs/plans/planning-skeleton-migration-plan.md` | DONE   |
| 9   | `docs/audits/arbiter-skeleton-gap-analysis.md`   | DONE   |
| 10  | `docs/audits/planning-orphan-debt.md`            | DONE   |

**Acceptance:** `jq empty` on both JSON files exits 0; `jq '.dimensions | length'` = 76;
all 10 files exist; every KIT dim has a row; every planning artifact has a PLAN-NNN entry.

---

### W2 — KIT Canonical SSOT

**Goal:** Typed TypeScript module for the 76-dim catalog with enforcement gate.

| Track | Deliverables                                                          |
| ----- | --------------------------------------------------------------------- |
| A     | `src/kit/{taxonomy.ts,catalog.ts,index.ts}`                           |
| A     | `src/commands/kit.ts` (arbiter kit list/show/validate)                |
| A     | `docs/ADR/045-kit-taxonomy.md`                                        |
| A     | `scripts/check-kit-catalog-parity.mjs` → L1 gate                      |
| A     | INV-86 in `src/invariants/catalog.ts`                                 |
| B3    | 76 reference docs `docs/REFERENCE/dim-001-*.md … dim-076-*.md`        |
| B1/B2 | `src/templates/kit/*.ejs` + `src/generators/kit.ts` + `GLOBAL_KIT.md` |

**Acceptance:** `arbiter kit validate` exits 0; `check-kit-catalog-parity.mjs` exits 0; ADR-045 referenced from AGENTS.md.

---

### W3 — Local Wrapper + Hook Parity Façade

**Goal:** Single-entrypoint Makefile mirroring CI tiers; parity contract machine-verifiable.

| Track | Deliverables                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------- |
| A     | `Makefile` (POSIX; targets: help/check/gate/full/simulate-nightly/simulate-weekly/evidence/clean) |
| A     | `run.sh` thin shim delegating to make                                                             |
| A     | Extend `scripts/setup-repo.sh` (git hooks path + Node version check)                              |
| A     | Extend `scripts/check-local-ci-parity.mjs` (Makefile↔workflow drift)                              |
| A     | INV-87 in catalog                                                                                 |
| B1/B2 | `src/templates/local-wrapper/Makefile.ejs` + `run.sh.ejs` + `.env.example.ejs` (N-01)             |
| B2    | `src/generators/local-wrapper.ts` + `src/generators/env-template.ts`                              |
| B3    | `docs/REFERENCE/local-wrapper-contract.md`                                                        |

**Acceptance:** `make ci` exits 0; parityContentHash matches workflow job list; `arbiter init` emits Makefile.

---

### W4 — CI Tier Baseline

**Goal:** Re-enable arbiter's own CI from zero; 4 baseline workflows + labels + dependabot.

| Track | Deliverables                                                                         |
| ----- | ------------------------------------------------------------------------------------ |
| A     | `.github/workflows/01-pr-fast.yml` (T2 PR gate, SHA-pinned)                          |
| A     | `.github/workflows/02-pr-extended.yml` (dynamic gate)                                |
| A     | `.github/workflows/_notify.yml` (idempotent GH-Issue notification)                   |
| A     | `.github/workflows/09-heartbeat-external.yml` (ubuntu-latest watchdog)               |
| A     | `.github/labels.yml` + `.github/workflows/_label-sync.yml`                           |
| A     | `.github/dependabot.yml` (github-actions + npm grouped weekly)                       |
| A     | `.github/actions/setup-node-pnpm/action.yml` (composite action)                      |
| A     | Update INV-73 status to "transition" in catalog                                      |
| B1    | EJS templates for each workflow above                                                |
| B3    | `docs/REFERENCE/ci-tier-workflows.md` + `docs/REFERENCE/cicd-developer-reference.md` |

**Acceptance:** `01-pr-fast` green on W4 PR; INV-73 status updated; `arbiter init` emits 4-workflow baseline.

---

### W5 — Stack Adapter Model

**Goal:** Formal interface for multi-stack support; TS adapter (arbiter-self); stubs for other stacks.

| Track | Deliverables                                               |
| ----- | ---------------------------------------------------------- |
| A     | `src/adapters/StackAdapter.ts` interface                   |
| A     | `src/adapters/_registry.ts` + `src/adapters/typescript.ts` |
| A     | `scripts/check-adapter-coverage.mjs`                       |
| A     | `docs/ADR/046-stack-adapter.md` + INV-88                   |
| B     | Stub adapters: `src/adapters/{java,python,go,rust}.ts`     |
| B3    | `docs/REFERENCE/stack-adapter-contract.md`                 |

**Acceptance:** `arbiter doctor` reports TS adapter active; `check-adapter-coverage.mjs` exits 0.

---

### W6 — Anti-Drift Validator Family

**Goal:** Port 13 agnostic validators from planning's 22; remaining 9 to F4.

| Track | Deliverables                                                  |
| ----- | ------------------------------------------------------------- |
| A     | `scripts/check-workflow-{sha-pinning,runners,job-naming}.mjs` |

_[content truncated — see source for full text]_
