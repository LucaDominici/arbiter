---
title: Skeleton Governance Architecture
type: architecture
status: ACTIVE
date: 2026-05-19
issue: '#876'
doc_version: '1.0.0'
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Skeleton Governance Architecture

> Single SSOT defining the target architecture for arbiter's engineering skeleton harness.
> Every primitive used across W2-W11 is named here.
> Downstream: `docs/architecture/dual-track-contract.md`, `docs/audits/arbiter-skeleton-gap-analysis.md`.

---

## Primitive Taxonomy

### HarnessCategory (16-enum)

Every artifact in the engineering skeleton belongs to exactly one category.

| Value                   | Description                                                         | Arbiter Primitive                                                   |
| ----------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `local-command-harness` | Developer-facing entrypoint scripts and Makefile/run.sh façade      | `Makefile`, `run.sh`, `scripts/check-all.mjs`                       |
| `ci-workflow`           | GitHub Actions workflow files (.github/workflows/\*.yml)            | `.github/workflows/*.yml` + EJS templates                           |
| `parity-mechanism`      | Contracts verifying local command output ↔ CI job output            | `scripts/check-local-ci-parity.mjs` + INV-87                        |
| `test-harness`          | Test taxonomy, test runners, test types, evidence schema            | `docs/TEST_TAXONOMY.md`, `schemas/evidence-bundle.schema.json`      |
| `contract-verification` | API schema, pact, OpenAPI, Newman contract tests                    | `src/templates/contract/` (framework only)                          |
| `static-analysis`       | Lint, format, type-check, dead code, architectural rule enforcement | `scripts/check-*.mjs` (agnostic) + stack adapter (stack-specific)   |
| `supply-chain-check`    | Signing, SBOM, Trivy, OWASP dependency check, secret scanning       | `.github/workflows/05-release.yml`, `scripts/check-secret-scan.mjs` |
| `evidence-capture`      | Commands + outputs captured in machine-readable bundles             | `.evidence/*/`, `scripts/evidence-*.mjs`                            |
| `docs-governance`       | Docs that are required by protocol (AGENTS.md, ADRs, runbooks)      | `AGENTS.md`, `docs/ADR/`, `docs/SYSTEM/`                            |
| `agent-instruction`     | Directives for AI agents (AGENTS.md, .claude/agents/\*.md)          | `.claude/agents/*.md`, `AGENTS.md`                                  |
| `agent-command`         | Claude Code slash commands (.claude/commands/\*.md)                 | `.claude/commands/*.md`                                             |
| `hook`                  | Pre/post edit/bash hooks and git hooks                              | `.claude/hooks/*.mjs`, `.githooks/`                                 |
| `bootstrap`             | Repo initialization scripts (setup-repo.sh, arbiter init)           | `scripts/setup-repo.sh`, `src/commands/init.ts`                     |
| `release`               | Release workflow, signing, artifact publishing                      | `.github/workflows/05-release.yml`, `sign-and-attest` action        |
| `issue-governance`      | Label sync, PR template, PR staleness, notify workflows             | `.github/labels.yml`, `.github/workflows/_*.yml`                    |
| `anti-drift-validator`  | Scripts checking that repo state matches declared contracts         | `scripts/check-*.mjs` (drift family)                                |

---

### GateType (6-enum)

Every KIT dimension has exactly one gate type governing when and how failure is reported.

| Value               | Meaning                                                                              | When enforced                       |
| ------------------- | ------------------------------------------------------------------------------------ | ----------------------------------- |
| `BLOCKING`          | Fails the gate; merge blocked until resolved                                         | Every PR (L1 + L2 gate)             |
| `BLOCKING(nightly)` | Fails nightly run; creates `nightly-down` issue                                      | Nightly workflow (`06-nightly.yml`) |
| `BLOCKING(locale)`  | Required in generated project's local wrapper (Makefile target or run.sh subcommand) | `make gate` / `./run.sh gate`       |
| `BLOCKING(pharma)`  | Required for pharma-regulated profiles; skipped otherwise                            | Stack adapter pharma conditional    |
| `ADVISORY`          | Warning reported; merge allowed                                                      | L2 gate (informational)             |
| `REFERENCE`         | Documentation only; no machine enforcement                                           | Docs + framework template only      |

**Gate depth allocation:**

| Gate       | Tier | Contents                                          |
| ---------- | ---- | ------------------------------------------------- |
| L1 fast    | T1   | All BLOCKING dims with runtime < 30s each         |
| L2 full    | T2   | All BLOCKING + BLOCKING(locale) + ADVISORY dims   |
| Nightly    | T3   | BLOCKING(nightly) dims + slow supply chain checks |
| Local fast | T0   | Subset of T1 (pre-commit hook; ≤10 dims)          |

---

### MaturityTier (3-level)

| Value | Alias in XLSX | Meaning                                 | When required                       |
| ----- | ------------- | --------------------------------------- | ----------------------------------- |
| `M1`  | `L1`          | Baseline — any production project       | Default tier; always generated      |
| `M2`  | `L2`          | Intermediate — regulated or high-stakes | `governanceLevel >= 2` in generator |
| `M3`  | `L3`          | Advanced — pharma / high-assurance      | `governanceLevel == 3` in generator |

**TML alias note:** The KIT XLSX uses L1/L2/L3. Arbiter canonical is M1/M2/M3 to avoid collision with the T1/T2/T3 gate-depth tier. ADR-045 records this alias.

---

### StackTag (8-enum)

| Value         | Meaning                                                |
| ------------- | ------------------------------------------------------ |
| `agnostic`    | Applies to all stacks; emitted by core framework       |
| `java_spring` | Java + Spring Boot; emitted by Java stack adapter (F2) |
| `node_ts`     | Node.js + TypeScript; emitted by TS adapter (W5)       |
| `python`      | Python; stub adapter (F2-python)                       |
| `go`          | Go; stub adapter (F2-go)                               |
| `rust`        | Rust; stub adapter (F2-rust)                           |
| `mixed`       | Cross-stack (e.g., GitHub Actions calling any runtime) |
| `template`    | Framework template only; no arbiter-self enforcement   |

---

### EvidenceArtifact

Every CI run and local gate produces an evidence artifact. Minimum bundle per run:

```
.evidence/<batch-id>/
├── summary.md            # What ran, what passed/failed, duration
├── commands-run.txt      # Exact commands in order
├── exit-codes.json       # {"<command>": <exit_code>} map
└── toolchain.md          # Tool versions snapshot (from audit-toolchain.mjs)
```

Batch ID format: `<context>-YYYYMMDD-HHMM` (e.g., `pr-20260519-1430`, `nightly-20260519-0300`).

Schema: `schemas/evidence-bundle.schema.json` (W7).
Validator: `scripts/check-evidence-bundle.mjs` (W7, INV-90).

---

### TemplateContract

Every EJS template under `src/templates/` must satisfy:

1. **Named** — filename matches `<category>/<purpose>[.<ext>].ejs`
2. **Parameterized** — all project-specific values from `GeneratorContext` type; no hardcoded service names
3. **Gated** — `<% if (governanceLevel >= N) { %>` guards for M2/M3-only features (CANON-13)
4. **Referenced** — cited in the generator that emits it (`src/generators/*.ts`)
5. **Tested** — at least one fixture run validates the rendered output
6. **KIT-linked** — comment header `{{!-- KIT dim: N, M --}}` citing applicable dims

---

### ProjectConformanceCheck

A generated project is conformant when:

- All BLOCKING KIT dims applicable to its stack + maturity tier have gate scripts exiting 0
- `make gate` (or `./run.sh gate`) ↔ CI `01-pr-fast` parity hash matches
- Evidence bundle present after each gate run
- No suppression without rationale + expiry date (W6 validator)
- All anti-drift validators exit 0 on the project tree

Conformance is checked by `arbiter doctor` (existing CLI) + `scripts/check-self-dogfood.mjs`.

---

### LocalCICompatibilityContract

**Invariant (INV-87):** Every CI workflow job has an equivalent local command. Drift is a gate failure.

| CI workflow      | Local equivalent        | Max delta                       |
| ---------------- | ----------------------- | ------------------------------- |
| `01-pr-fast`     | `make gate`             | ±0 (same scripts, same flags)   |
| `02-pr-extended` | `make full`             | ±0                              |
| `06-nightly`     | `make simulate-nightly` | ±allowed-skips (env-only steps) |
| `07-weekly`      | `make simulate-weekly`  | ±allowed-skips                  |

The parity contract is machine-verified by `scripts/check-local-ci-parity.mjs`. A `parityContentHash` in `.arbiter/gate/local-result.json` must match the hash of the workflow job list.

---

## Arbiter Primitives Map

| Primitive Type  | Arbiter representation                                                             | Enforcement mechanism                           |
| --------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------- |
| Invariant rule  | `src/invariants/catalog.ts` entry + `GLOBAL_INVARIANTS.md`                         | `scripts/check-*.mjs` in gate                   |
| Gate script     | `scripts/check-*.mjs` (agnostic) or stack adapter emits                            | `check-all.mjs` orchestration                   |
| Git hook        | `.githooks/pre-commit` (arbiter-self) + `src/templates/hooks/*.ejs`                | `setup-repo.sh` installs                        |
| CI workflow     | `.github/workflows/*.yml` (arbiter-self) + `src/templates/github/workflows/*.ejs`  | Generator emits per tier                        |
| Generator       | `src/generators/*.ts`                                                              | `arbiter init` invokes                          |
| Template        | `src/templates/**/*.ejs`                                                           | EJS render via generator                        |
| Stack adapter   | `src/adapters/<stack>.ts` implementing `StackAdapter` interface                    | `src/adapters/_registry.ts`                     |
| Evidence        | `.evidence/<batch>/`                                                               | `scripts/evidence-rotate.mjs`                   |
| KIT catalog     | `src/kit/catalog.ts`                                                               | `scripts/check-kit-catalog-parity.mjs` (INV-86) |
| Makefile target | `Makefile` (arbiter-self) + `src/templates/local-wrapper/Makefile.ejs`             | `check-local-ci-parity.mjs`                     |
| ADR             | `docs/ADR/NNN-*.md` (arbiter-self) + referenced from `docs/REFERENCE/dim-NNN-*.md` | Docs only; no gate                              |
| Sub-agent       | `.claude/agents/*.md`                                                              | `.claude/settings.json` registration            |
| Agent command   | `.claude/commands/*.md`                                                            | Claude Code skill invocation                    |

---

## Dual-Track Realization Per Primitive

For every primitive introduced in W2-W11, both tracks ship in the same PR:

| Primitive     | Track A (arbiter-self)                    | Track B1 (EJS template)                                    | Track B2 (generator)                      | Track B3 (KIT doc)                           | Track B4 (invariant) |
| ------------- | ----------------------------------------- | ---------------------------------------------------------- | ----------------------------------------- | -------------------------------------------- | -------------------- |
| Gate script   | `scripts/check-*.mjs`                     | `src/templates/scripts/*.mjs.ejs`                          | `src/generators/anti-drift-validators.ts` | `docs/REFERENCE/dim-NN-*.md`                 | INV-NN in catalog    |
| CI workflow   | `.github/workflows/*.yml`                 | `src/templates/github/workflows/*.yml.ejs`                 | `src/generators/github-workflows.ts`      | `docs/REFERENCE/ci-tier-workflows.md`        | INV-73 update        |
| Makefile      | `Makefile`                                | `src/templates/local-wrapper/Makefile.ejs`                 | `src/generators/local-wrapper.ts`         | `docs/REFERENCE/local-wrapper-contract.md`   | INV-87               |
| Stack adapter | `src/adapters/typescript.ts`              | n/a (adapter IS the template mechanism)                    | `src/adapters/_registry.ts`               | `docs/REFERENCE/stack-adapter-contract.md`   | INV-88               |
| KIT catalog   | `src/kit/catalog.ts`                      | `src/templates/kit/*.ejs`                                  | `src/generators/kit.ts`                   | `docs/REFERENCE/dim-001-*.md … dim-076-*.md` | INV-86               |
| Evidence      | `.evidence/<batch>/`                      | `src/templates/evidence/*.ejs`                             | `src/generators/test-taxonomy.ts`         | `docs/REFERENCE/evidence-schema.md`          | INV-90               |
| Supply chain  | `.github/workflows/05-release.yml`        | `src/templates/github/workflows/05-release.yml.ejs`        | `src/generators/github-workflows.ts`      | `docs/REFERENCE/supply-chain.md`             | INV-92               |
| AI-PR gate    | `.github/workflows/_label-on-approve.yml` | `src/templates/github/workflows/_label-on-approve.yml.ejs` | `src/generators/github-workflows.ts`      | `docs/REFERENCE/ai-pr-gate.md`               | INV-91               |

Not all four B sub-tracks apply to every primitive. The per-wave matrix in `docs/plans/planning-skeleton-migration-plan.md` specifies which.

---

## Architecture Questions (12)

### Q1 — How does the framework emit skeleton patterns to generated projects?

Every skeleton pattern has a corresponding EJS template under `src/templates/`. The `arbiter init` command (backed by `src/generators/*.ts`) renders templates parameterized by `GeneratorContext` (stack, governance level, project name). Generated projects receive an identical structural harness, not a copy of arbiter-self files.

### Q2 — How is the dual-track separation enforced?

CANON-04/05/07/11 (`.claude/rules/30-canon-enforcement.md`) require that any new gate/hook/template/generator satisfies the dual-track contract. `check-no-orphan-todo.mjs` and `pre-edit-plan-anchor.mjs` prevent solo-track implementations from entering the tree. `docs/architecture/dual-track-contract.md` is the binding contract.

### Q3 — How is local↔CI parity proven?

`scripts/check-local-ci-parity.mjs` computes a `parityContentHash` from the Makefile target list + CI workflow job list. Hash mismatch = gate fail (INV-87). Any drift that survives a gate run is a regression.

### Q4 — How are Java/Spring-specific patterns isolated?

Stack-specific dims (tag: `java_spring`) route to `src/adapters/java.ts` (F2). Core scripts and templates only reference `agnostic`-tagged dims. The `StackAdapter` interface (W5) is the only bridge; it returns `GateDescriptor[]` and `WorkflowTemplateRef[]`, not raw files.

### Q5 — How are KIT dims linked to invariants and scripts?

`src/kit/catalog.ts` is the SSOT. Each dim entry carries `invariant_id` (nullable). Each gate script cites `// KIT dim: N` in its header. `scripts/check-kit-catalog-parity.mjs` (INV-86) verifies that every dim with `gate_type: "BLOCKING"` has either an `invariant_id` or a `validator` in `framework_realization`.

### Q6 — How are suppressions handled?

Suppressions require: (1) a rationale comment, (2) an expiry date, (3) CODEOWNERS approval for suppression files. Enforced by `scripts/check-suppression-rationale.mjs` + `scripts/check-suppression-expiry.mjs` (W6, INV-89 family).

### Q7 — How does the evidence bundle prove conformance?

Every gate run writes to `.evidence/<batch>/`. The `schemas/evidence-bundle.schema.json` defines minimum required files. `scripts/check-evidence-bundle.mjs` validates every existing bundle against the schema (INV-90).

### Q8 — How does the AI-PR gate satisfy 21 CFR §11.10(g)?

`_label-on-approve.yml` applies `approved-by-human` only when: reviewer ≠ author AND reviewer.type ≠ Bot AND review.state = APPROVED. `_ai-draft-check.yml` blocks merge unless that label is present on AI-authored PRs. Triple-check documented in `docs/REFERENCE/ai-pr-gate.md`.

### Q9 — How are templates parameterized across 3 governance levels?

Generator context includes `governanceLevel: 1 | 2 | 3`. EJS templates use `<% if (governanceLevel >= 2) { %>` guards (CANON-13). Level 1 gets baseline harness; Level 2 adds extended checks; Level 3 adds pharma/supply-chain overlays.

### Q10 — How is INV-73 (CI tier presence) resolved across waves?

W4 ships 4 baseline workflows → INV-73 status: `transition`. W8 adds AI-PR workflows. W9 adds release. W10 adds nightly/weekly/heartbeat → INV-73 status: `closed` (8/8 tier workflows). The catalog entry tracks the transition state explicitly.

### Q11 — How does supply chain signing work in generated projects?

`src/templates/github/workflows/05-release.yml.ejs` + `sign-and-attest/action.yml.ejs` provide the signing composite action. Generated only for `governanceLevel >= 2`. At `governanceLevel == 3`, Trivy strict and SBOM attestation are mandatory (INV-92).

### Q12 — How does the anti-drift family stay current?

Each anti-drift validator in `scripts/check-*.mjs` must support `--help` (INV-89). New validators are added to `check-all.mjs` at L1 (fast, <5s) or L2 (slow). The drift map in `scripts/check-drift.mjs` maintains an explicit catalog of known-drift pairs. Any new workflow/template/invariant trio must have a corresponding drift-check entry.

---

## References

- `docs/plans/planning-skeleton-migration-plan.md` — wave execution playbook
- `docs/architecture/dual-track-contract.md` — binding dual-track contract
- `docs/audits/kit-canonical-mapping.json` — machine-readable 76-dim catalog
- `docs/audits/arbiter-skeleton-gap-analysis.md` — severity-rated gap matrix
- `docs/REFERENCE/external-kit-sources.md` — KIT XLSX pointer + refresh procedure
- `AGENTS.md` — invariants INV-73, INV-86..INV-93
