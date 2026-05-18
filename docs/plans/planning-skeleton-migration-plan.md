---
title: Planning Skeleton Migration Plan
type: plan
status: ACTIVE
date: 2026-05-19
issue: '#876'
---

# Planning Skeleton Migration Plan

> Executable playbook for importing and rationalizing patterns from `cloud.ms5.planning-main`
> into arbiter across dual tracks (A: arbiter-for-itself; B: arbiter-as-framework).
> Full scope definition: `/.claude/plans/you-are-claude-opus-humming-melody.md`

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

| Track | Deliverables                                                                                |
| ----- | ------------------------------------------------------------------------------------------- |
| A     | `scripts/check-workflow-{sha-pinning,runners,job-naming}.mjs`                               |
| A     | `scripts/check-{validator-helptext,suppression-rationale,suppression-expiry}.mjs`           |
| A     | `scripts/check-{tier-coverage,workflow-docs-sync,workflow-test-integrity,pr-size-gate}.mjs` |
| A     | `scripts/check-pii-scan.mjs` + `data/pii-patterns.txt` (N-02/N-07)                          |
| A     | `scripts/check-secret-scan.mjs` (N-03)                                                      |
| A     | `scripts/check-drift.mjs` (N-04, ~400 LOC equivalent)                                       |
| A     | Wire all into `check-all.mjs` L1/L2                                                         |
| A     | INV-89                                                                                      |
| B1/B2 | EJS templates + `src/generators/anti-drift-validators.ts`                                   |
| B3    | `docs/REFERENCE/anti-drift-family.md`                                                       |

**Acceptance:** Gate still green with new validators; all new validators support `--help`; `arbiter init` emits subset.

---

### W7 — Test Taxonomy + Evidence Schema

**Goal:** Align TEST_TAXONOMY.md with KIT dim 25; formal evidence bundle schema.

| Track | Deliverables                                                                     |
| ----- | -------------------------------------------------------------------------------- |
| A     | Refresh `docs/TEST_TAXONOMY.md` (KIT dim 25 + concurrency/migration/performance) |
| A     | `schemas/evidence-bundle.schema.json`                                            |
| A     | `scripts/check-evidence-bundle.mjs` + INV-90                                     |
| A     | `docs/architecture/evidence-bundle.md`                                           |
| B1/B2 | `src/templates/testing/TEST_TAXONOMY.md.ejs` + `src/generators/test-taxonomy.ts` |
| B3    | `docs/REFERENCE/evidence-schema.md`                                              |

---

### W8 — Agent Governance (AI-PR + Human Approval)

**Goal:** Full SoD AI-PR triple-check; PR staleness automation; idempotent notify enhancement.

| Track | Deliverables                                                              |
| ----- | ------------------------------------------------------------------------- |
| A     | `.github/workflows/{_label-on-approve,_ai-draft-check,_pr-staleness}.yml` |
| A     | `.claude/agents/ai-pr-gate.md`                                            |
| A     | INV-91                                                                    |
| B1    | EJS templates for the 3 workflows + PR template                           |
| B3    | `docs/REFERENCE/ai-pr-gate.md` (21 CFR §11.10(g) rationale)               |

---

### W9 — Supply Chain (Sigstore + SBOM + Trivy)

**Goal:** Auditable release pipeline with keyless signing and SBOM attestation.

| Track | Deliverables                                              |
| ----- | --------------------------------------------------------- |
| A     | `.github/workflows/{05-release,_sigstore-retry-sign}.yml` |
| A     | `.github/actions/sign-and-attest/action.yml`              |
| A     | `.trivyignore` (empty with rationale/expiry policy)       |
| A     | INV-92                                                    |
| B1    | EJS templates for release flow                            |
| B3    | `docs/REFERENCE/supply-chain.md`                          |

---

### W10 — Nightly + Weekly + Heartbeat

**Goal:** Close INV-73 — all 8 CI tier workflows present.

| Track | Deliverables                                                                |
| ----- | --------------------------------------------------------------------------- |
| A     | `.github/workflows/{06-nightly,07-weekly,08-heartbeat,_cleanup-weekly}.yml` |
| A     | `scripts/check-nightly-freshness.mjs` + INV-93                              |
| B1    | EJS templates for nightly/weekly/heartbeat/cleanup-weekly                   |
| B2    | Generator emits nightly job matrix per stack adapter                        |
| B3    | `docs/REFERENCE/nightly-weekly-heartbeat.md`                                |

**Acceptance:** INV-73 closed (8/8 workflows); heartbeat produces artifact; `check-nightly-freshness.mjs` exits 0.

---

### W11 — Verification + Evidence Bundle

**Goal:** Self-validation drill; close the loop; evidence bundle committed.

Deliverables:

- `scripts/audit-toolchain.mjs` (N-05) + template + generator
- `.evidence/planning-skeleton-migration-YYYYMMDD-HHMM/` bundle
- `arbiter init` on TS fixture → `make ci` inside fixture → green (dogfood loop closed)
- Update umbrella issue + close sub-issues
- Memory writes: `project_planning_skeleton_migration.md`, `reference_kit_canonical_sources.md`

---

## Follow-Up Issues (F1–F12)

| Issue             | Title                                            | Wave | Size |
| ----------------- | ------------------------------------------------ | ---- | ---- |
| F1                | Normalize `docs/` casing (UPPERCASE → lowercase) | —    | M    |
| F2-java           | Java stack adapter (~94 dims)                    | —    | XL   |
| F2-python/go/rust | Other stack adapters                             | —    | XL   |
| F3                | AI-PR + human-approval gate end-to-end           | —    | M    |
| F4                | Port remaining 9 anti-drift validators           | —    | M    |
| F5                | Pharma Audit-Trail overlay (dims 73-75)          | —    | M    |
| F6                | k6 perf ecosystem template                       | —    | XL   |
| F7                | Postman/Newman contract test template            | —    | L    |
| F8                | ZAP DAST nightly auth template                   | —    | M    |
| F9                | API contract baselines template                  | —    | M    |
| F10               | Deploy workflow templates (03/04)                | —    | L    |
| F11               | Azure ContainerApp infra template                | —    | S    |
| F12               | Documentation template-set                       | —    | M    |

---

## Verification Commands (Replay)

```bash
# After W1 (current)
jq '.dimensions | length' docs/audits/kit-canonical-mapping.json    # must = 76
jq '.items | length' docs/audits/planning-skeleton-inventory.json   # must = 123
node scripts/check-doc-links.mjs                                     # 0 broken links

# After W4
node scripts/check-all.mjs L1                                        # gate green
gh workflow view .github/workflows/01-pr-fast.yml                   # exists

# After W10 (INV-73 closed)
node scripts/check-all.mjs simulate-nightly
ls .github/workflows/*.yml | wc -l                                   # >= 8

# End-to-end (W11)
make ci
make simulate-nightly
node scripts/check-all.mjs full --json .arbiter/gate/full.json
ls -la .evidence/planning-skeleton-migration-*/
gh issue view <umbrella-id> --json comments
```
