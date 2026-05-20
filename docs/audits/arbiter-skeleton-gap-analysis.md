---
title: Arbiter Skeleton Gap Analysis
type: audit
status: active
date: 2026-05-19
issue: '#876'
doc_version: '1.0.0'
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/auditor', 'audience/dev', 'kind/audit']
related: []
---

# Arbiter Skeleton Gap Analysis

> 16-category gap matrix: arbiter current state vs planning capability vs KIT dims involved.
> Zero "unknown" rows allowed.
> Source: `planning-skeleton-inventory.json` + `kit-canonical-mapping.json` + Phase 0 arbiter scan.

---

## Gap Severity Legend

| Severity      | Meaning                                                             |
| ------------- | ------------------------------------------------------------------- |
| `none`        | Arbiter matches or exceeds planning capability                      |
| `minor`       | Small gap; addressed within ongoing waves                           |
| `significant` | Real capability missing; dedicated wave needed                      |
| `critical`    | Core contract violated (e.g., INV-73); must resolve before shipping |

---

## Gap Matrix

### 1. local-command-harness

| Field                    | Value                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Arbiter current**      | `scripts/check-all.mjs` (L1/L2/L3), `npm run ...` convenience scripts. No Makefile or run.sh façade.           |
| **Planning capability**  | `run.sh` (1640 LOC, 26 subcommands), explicit CI-parity table, used by devs and CI equally.                    |
| **KIT dims involved**    | 26 (local wrapper contract), 29 (parity mechanism)                                                             |
| **Gap severity**         | `significant`                                                                                                  |
| **Target**               | `arbiter-internal` + `framework-core`                                                                          |
| **Rationale**            | Single-entrypoint façade is the primary developer experience contract; without it, CI-parity is unenforceable. |
| **Proposed sub-issue**   | W3.1 — Makefile façade with parity contract                                                                    |
| **Evidence requirement** | `make gate` exits 0; `parityContentHash` matches CI job list                                                   |

---

### 2. ci-workflow

| Field                    | Value                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **Arbiter current**      | Zero workflows (`37b0e68` nuked everything). INV-73 violated.                                                      |
| **Planning capability**  | 18 active workflows covering PR gates, deploy, release, nightly, weekly, heartbeat, issue governance.              |
| **KIT dims involved**    | 34 (01-pr-fast), 35 (02-pr-extended), 36 (nightly), 37 (release), 38 (AI-PR gate), 39 (heartbeat), 40 (label sync) |
| **Gap severity**         | `critical`                                                                                                         |
| **Target**               | `arbiter-internal` + `framework-core`                                                                              |
| **Rationale**            | INV-73 is explicitly violated. Zero CI = no automated quality gate for arbiter itself.                             |
| **Proposed sub-issue**   | W4.1 — 4 baseline workflows (PR fast, PR extended, heartbeat-external, notify)                                     |
| **Evidence requirement** | `01-pr-fast` green on W4 PR; INV-73 status updated to `transition`                                                 |

---

### 3. parity-mechanism

| Field                    | Value                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| **Arbiter current**      | `scripts/check-local-ci-parity.mjs` exists but has no Makefile façade to connect to.              |
| **Planning capability**  | Explicit parity table in `docs/ci/README.md §3b`; `run.sh simulate <tier>` mirrors every CI tier. |
| **KIT dims involved**    | 26 (local CI compatibility contract)                                                              |
| **Gap severity**         | `minor`                                                                                           |
| **Target**               | `arbiter-internal` + `framework-core`                                                             |
| **Rationale**            | Script exists; needs Makefile integration and parity hash enforcement (INV-87).                   |
| **Proposed sub-issue**   | W3.1 (same as local-command-harness — both resolved together)                                     |
| **Evidence requirement** | `parityContentHash` in `.arbiter/gate/local-result.json` matches CI job list                      |

---

### 4. test-harness

| Field                    | Value                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| **Arbiter current**      | `docs/TEST_TAXONOMY.md` exists with 8 categories. `__tests__/` tree with real-project fixtures.       |
| **Planning capability**  | `docs/testing/TEST_TAXONOMY.md` with 25 `@Tag` categories × ~280 cases. KIT dim 25 fully implemented. |
| **KIT dims involved**    | 25 (test taxonomy), 31 (concurrency tests), 32 (migration tests), 33 (performance tests)              |
| **Gap severity**         | `minor`                                                                                               |
| **Target**               | `arbiter-internal` + `framework-core`                                                                 |
| **Rationale**            | Taxonomy exists but is missing dims 31/32/33 and needs alignment with KIT dim 25.                     |
| **Proposed sub-issue**   | W7 — test taxonomy refresh + evidence schema                                                          |
| **Evidence requirement** | `docs/TEST_TAXONOMY.md` covers all KIT dim 25 categories plus dims 31/32/33                           |

---

### 5. contract-verification

| Field                    | Value                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| **Arbiter current**      | No Postman/Newman contract tests; no API snapshot validation.                                                       |
| **Planning capability**  | Newman E2E suite, pact samples, API snapshot baselines, OpenAPI daily validation, `run-postman-tests.sh` (414 LOC). |
| **KIT dims involved**    | 48 (API contract tests), 49 (pact tests)                                                                            |
| **Gap severity**         | `significant`                                                                                                       |
| **Target**               | `project-template` only (arbiter publishes npm, not an HTTP API)                                                    |
| **Rationale**            | Arbiter has no API to contract-test. Contract verification is a generated-project concern.                          |
| **Proposed sub-issue**   | F7 — Postman/Newman contract test ecosystem template                                                                |
| **Evidence requirement** | `arbiter init` at M2 emits Newman workflow template                                                                 |

---

### 6. static-analysis

| Field                    | Value                                                                                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Arbiter current**      | ESLint + Prettier + TypeScript type-check + `knip` dead code via `scripts/check-*.mjs`. Gitleaks present.                                                                                                      |
| **Planning capability**  | 22 anti-drift validators + Checkstyle + PMD + SpotBugs + ArchUnit (Java). Agnostic subset: SHA pinning, runner pin, job naming, suppression expiry/rationale, tier coverage, workflow-docs sync, PR-size gate. |
| **KIT dims involved**    | 50 (workflow SHA pinning), 51 (runner pin), 52 (job naming), 53 (suppression rationale), 54 (suppression expiry), 55 (tier coverage), 56 (workflow docs sync), 57 (PR size gate)                               |
| **Gap severity**         | `significant`                                                                                                                                                                                                  |
| **Target**               | `arbiter-internal` (agnostic validators) + `stack-adapter` (Java-specific)                                                                                                                                     |
| **Rationale**            | 13 agnostic validators are directly portable; Java validators need F2 adapter.                                                                                                                                 |
| **Proposed sub-issue**   | W6.1 (8 agnostic validators), W6.2 (pii/secret/drift), F2 (java validators), F4 (remaining 9 agnostic)                                                                                                         |
| **Evidence requirement** | All new validators support `--help`; gate still green after wiring                                                                                                                                             |

---

### 7. supply-chain-check

| Field                    | Value                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Arbiter current**      | `.gitleaks.toml` present. No Trivy, no SBOM, no Sigstore, no OWASP DC.                                                                                 |
| **Planning capability**  | Trivy strict blocking, SBOM CycloneDX, Sigstore keyless signing, OWASP DC (nightly), PITest (nightly/release), `_sigstore-retry-sign.yml` for outages. |
| **KIT dims involved**    | 15 (Trivy), 16 (SBOM), 37 (release signing), 62 (OWASP DC nightly), 64 (secret scan)                                                                   |
| **Gap severity**         | `significant`                                                                                                                                          |
| **Target**               | `arbiter-internal` (Trivy + SBOM + Sigstore for npm release) + `framework-core` (templates for generated projects)                                     |
| **Rationale**            | Arbiter ships npm packages; signing is directly applicable. Trivy + SBOM are M2+ requirements per KIT.                                                 |
| **Proposed sub-issue**   | W9 — supply chain (Sigstore + SBOM + Trivy)                                                                                                            |
| **Evidence requirement** | Tagged release produces signed artifact + SBOM attestation; Trivy blocking on CRITICAL                                                                 |

---

### 8. evidence-capture

| Field                    | Value                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **Arbiter current**      | `.evidence/` directory with 22 entries. `scripts/evidence-prune.mjs` + `scripts/evidence-rotate.mjs`. No schema. |
| **Planning capability**  | `audit-toolchain.sh` producing dated MD snapshots; evidence bundles with structured content.                     |
| **KIT dims involved**    | 67 (evidence bundle)                                                                                             |
| **Gap severity**         | `minor`                                                                                                          |
| **Target**               | `arbiter-internal` + `framework-core`                                                                            |
| **Rationale**            | Evidence exists but lacks a schema and a validator. W7 adds both.                                                |
| **Proposed sub-issue**   | W7 — evidence schema + validator (INV-90)                                                                        |
| **Evidence requirement** | `schemas/evidence-bundle.schema.json` validates all existing `.evidence/` batches                                |

---

### 9. docs-governance

| Field                    | Value                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Arbiter current**      | `AGENTS.md`, 44 ADRs, `docs/SYSTEM/` (CANON + DECISIONS + KNOWLEDGE_MAP), `docs/METHOD/`.                                                      |
| **Planning capability**  | `docs/ci/README.md`, `docs/testing/TEST_TAXONOMY.md`, `docs/security/`, `docs/runbooks/`, `SECURE_CODING_CHECKLIST.md`, `coding-standards.md`. |
| **KIT dims involved**    | 65 (docs completeness), 66 (runbook coverage), 68 (security docs), 76 (CI/CD README)                                                           |
| **Gap severity**         | `minor`                                                                                                                                        |
| **Target**               | `arbiter-internal` (CI README gap) + `project-template` (runbooks/security scaffold → F12)                                                     |
| **Rationale**            | Core governance docs are excellent; missing CI/CD developer reference at arbiter-self level; generated-project doc scaffold → F12.             |
| **Proposed sub-issue**   | W4 (CI tier reference doc), F12 (documentation template-set)                                                                                   |
| **Evidence requirement** | `docs/REFERENCE/cicd-developer-reference.md` exists; `check-doc-links.mjs` exits 0                                                             |

---

### 10. agent-instruction

| Field                    | Value                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| **Arbiter current**      | `AGENTS.md` (comprehensive), `.claude/agents/` (4 agents).                                            |
| **Planning capability**  | Agent governance with AI-PR gate, `--draft` default for agent PRs, `ai-draft-check` SoD triple-check. |
| **KIT dims involved**    | 38 (AI-PR gate), 60 (agent instruction completeness)                                                  |
| **Gap severity**         | `minor`                                                                                               |
| **Target**               | `arbiter-internal` (ai-pr-gate sub-agent) + `framework-core` (template for generated projects)        |
| **Rationale**            | Instruction content is strong; missing the ai-pr-gate sub-agent and triple-check workflow.            |
| **Proposed sub-issue**   | W8 — ai-pr-gate sub-agent + `_label-on-approve.yml`                                                   |
| **Evidence requirement** | `.claude/agents/ai-pr-gate.md` exists; `_label-on-approve.yml` passes triple-check spec               |

---

### 11. agent-command

| Field                    | Value                                                                        |
| ------------------------ | ---------------------------------------------------------------------------- |
| **Arbiter current**      | 9 slash commands + 7 skills. Comprehensive coverage.                         |
| **Planning capability**  | No equivalent (planning is a service, not a framework).                      |
| **KIT dims involved**    | 61 (agent command coverage)                                                  |
| **Gap severity**         | `none`                                                                       |
| **Target**               | `arbiter-internal` only (framework-core once stack adapter model stabilizes) |
| **Rationale**            | Arbiter's command set exceeds planning's; no gap to close.                   |
| **Proposed sub-issue**   | None                                                                         |
| **Evidence requirement** | n/a                                                                          |

---

### 12. hook

| Field                    | Value                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **Arbiter current**      | `.githooks/` (pre-commit, pre-push, commit-msg) + 22 `.claude/hooks/*.mjs`. Comprehensive.                                      |
| **Planning capability**  | Pre-push hook (spotless + gitleaks, ~2 min only), commit-msg hook. Lightweight by design (Fowler citation: pre-push fast only). |
| **KIT dims involved**    | 59 (pre-commit), 63 (pre-push), 64 (gitleaks in pre-push)                                                                       |
| **Gap severity**         | `none`                                                                                                                          |
| **Target**               | `done`                                                                                                                          |
| **Rationale**            | Arbiter's hooks exceed planning. Pre-push fast-only pattern already matches planning's design.                                  |
| **Proposed sub-issue**   | None                                                                                                                            |
| **Evidence requirement** | n/a                                                                                                                             |

---

### 13. bootstrap

| Field                    | Value                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Arbiter current**      | `scripts/setup-repo.sh` exists. `arbiter init` (CLI). `.nvmrc`.                                                                                     |
| **Planning capability**  | `scripts/setup-dev.sh` setting up local DB + Docker. `setup-java-maven` composite action.                                                           |
| **KIT dims involved**    | 71 (setup-repo script), 72 (CI composite action)                                                                                                    |
| **Gap severity**         | `minor`                                                                                                                                             |
| **Target**               | `arbiter-internal` (extend setup-repo.sh) + `framework-core` (composite action template)                                                            |
| **Rationale**            | `setup-repo.sh` exists; needs `git config core.hooksPath .githooks` enforcement + Node version check. Composite action (`setup-node-pnpm`) missing. |
| **Proposed sub-issue**   | W3.1 (extend setup-repo.sh), W4.1 (composite action for setup-node-pnpm)                                                                            |
| **Evidence requirement** | `setup-repo.sh` enforces hooksPath; composite action referenced from `01-pr-fast.yml`                                                               |

---

### 14. release

| Field                    | Value                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **Arbiter current**      | No release workflow. Nuked.                                                                                  |
| **Planning capability**  | `05-release.yml` (Sigstore + SBOM + Trivy strict + PITest), `_sigstore-retry-sign.yml`, cosign keyless OIDC. |
| **KIT dims involved**    | 37 (release signing), 15 (Trivy), 16 (SBOM)                                                                  |
| **Gap severity**         | `significant`                                                                                                |
| **Target**               | `arbiter-internal` (npm release) + `framework-core` (template for generated projects)                        |
| **Rationale**            | Arbiter publishes to npm. Signed + SBOM-attested release is a KIT M2 requirement.                            |
| **Proposed sub-issue**   | W9 — supply chain workflows                                                                                  |
| **Evidence requirement** | Tagged release produces signed npm package + SBOM attestation                                                |

---

### 15. issue-governance

| Field                    | Value                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Arbiter current**      | `.github/ISSUE_TEMPLATE/`, PR template. No `labels.yml`, no label-sync, no `dependabot.yml`.                                                   |
| **Planning capability**  | `labels.yml` declarative, `_label-sync.yml`, dependabot (grouped weekly), `zz-issue-state.yml`, `_pr-staleness.yml`, idempotent `_notify.yml`. |
| **KIT dims involved**    | 39 (heartbeat + notify), 40 (label-as-code), 69 (dependabot), 70 (PR staleness)                                                                |
| **Gap severity**         | `significant`                                                                                                                                  |
| **Target**               | `arbiter-internal` + `framework-core`                                                                                                          |
| **Rationale**            | Labels-as-code and dependabot are direct ports with zero modification. PR staleness is standard governance.                                    |
| **Proposed sub-issue**   | W4.1 (labels.yml + label-sync + dependabot), W8.1 (PR staleness)                                                                               |
| **Evidence requirement** | `labels.yml` synced to repo; `dependabot.yml` shows grouped weekly config; PR staleness closes draft at 60d                                    |

---

### 16. anti-drift-validator

| Field                    | Value                                                                                                                                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Arbiter current**      | Gate scripts exist (`check-all.mjs`, `check-doc-links.mjs`, `check-bloat-ratchet.mjs`, etc.). No workflow-specific drift validators (SHA pinning, runner pin, job naming, suppression handling).                                                               |
| **Planning capability**  | 22 validators: SHA pinning, runner pin, job naming, validator help-text, suppression rationale/expiry, tier coverage, workflow-docs sync, workflow-test-integrity, PR-size gate, k6 completeness, PII scan, secret scan, drift check, API contract validators. |
| **KIT dims involved**    | 50 (SHA pinning), 51 (runner pin), 52 (job naming), 53 (suppression rationale), 54 (suppression expiry), 55 (tier coverage), 56 (workflow docs sync), 57 (PR size gate), 58 (PII scan), 64 (secret scan)                                                       |
| **Gap severity**         | `significant`                                                                                                                                                                                                                                                  |
| **Target**               | `arbiter-internal` (13 agnostic) + `project-template` (perf/contract validators → F6/F7) + `stack-adapter` (java-specific → F2)                                                                                                                                |
| **Rationale**            | 13 agnostic validators are directly portable in W6; 9 follow to F4; Java-specific validators to F2.                                                                                                                                                            |
| **Proposed sub-issue**   | W6.1 (batch 1: 8 validators), W6.2 (pii/secret/drift), F4 (remaining 9 agnostic), F2 (java-specific)                                                                                                                                                           |
| **Evidence requirement** | All new validators support `--help`; `check-all.mjs` L1/L2 still green with new validators wired                                                                                                                                                               |

---

## Summary

| Category              | Severity     | Target                              | Wave       |
| --------------------- | ------------ | ----------------------------------- | ---------- |
| local-command-harness | significant  | arbiter-internal + framework-core   | W3         |
| ci-workflow           | **critical** | arbiter-internal + framework-core   | W4         |
| parity-mechanism      | minor        | arbiter-internal + framework-core   | W3         |
| test-harness          | minor        | arbiter-internal + framework-core   | W7         |
| contract-verification | significant  | project-template                    | F7         |
| static-analysis       | significant  | arbiter-internal + stack-adapter    | W6, F2     |
| supply-chain-check    | significant  | arbiter-internal + framework-core   | W9         |
| evidence-capture      | minor        | arbiter-internal + framework-core   | W7         |
| docs-governance       | minor        | arbiter-internal + project-template | W4, F12    |
| agent-instruction     | minor        | arbiter-internal + framework-core   | W8         |
| agent-command         | **none**     | arbiter-internal                    | —          |
| hook                  | **none**     | done                                | —          |
| bootstrap             | minor        | arbiter-internal + framework-core   | W3, W4     |
| release               | significant  | arbiter-internal + framework-core   | W9         |
| issue-governance      | significant  | arbiter-internal + framework-core   | W4, W8     |
| anti-drift-validator  | significant  | arbiter-internal + stack-adapter    | W6, F2, F4 |

**Critical:** 1 (ci-workflow — INV-73 violated)
**Significant:** 7 (local-command-harness, contract-verification, static-analysis, supply-chain-check, release, issue-governance, anti-drift-validator)
**Minor:** 6 (parity-mechanism, test-harness, evidence-capture, docs-governance, agent-instruction, bootstrap)
**None:** 2 (agent-command, hook)

---

## References

- `docs/audits/kit-canonical-mapping.json` — 76-dim KIT catalog with implementing-wave assignments
- `docs/audits/planning-skeleton-inventory.json` — 123 planning artifacts with disposition
- `docs/architecture/skeleton-governance.md` — primitive taxonomy and enforcement mechanisms
- `docs/plans/planning-skeleton-migration-plan.md` — wave execution playbook
