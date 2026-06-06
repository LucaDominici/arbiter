---
generated: true
source: 'docs/audits/arbiter-skeleton-gap-analysis.md'
source_sha: 'df630b5c026dac262fab4dd4588f9464e8b2fed7'
last_updated: '2026-06-06'
---

# Arbiter Skeleton Gap Analysis

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/audits/arbiter-skeleton-gap-analysis.md](../docs/audits/arbiter-skeleton-gap-analysis.md)

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

| Field

_[content truncated — see source for full text]_
