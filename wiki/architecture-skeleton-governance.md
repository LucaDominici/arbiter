---
generated: true
source: 'docs/architecture/skeleton-governance.md'
source_sha: '86ed0b22992c03ae035789962179ef9b5df0d2aa'
last_updated: '2026-06-06'
---

# Skeleton Governance Architecture

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/architecture/skeleton-governance.md](../docs/architecture/skeleton-governance.md)

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

A generated project is conforma

_[content truncated — see source for full text]_
