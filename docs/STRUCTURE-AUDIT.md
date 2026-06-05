---
title: 'Docs Structure Audit'
doc_version: '1.0.0'
status: active
last_review: '2026-06-05'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# Docs Structure Audit

**Scope:** Read-only decisional map of `docs/` as-of 2026-06-05. ZERO moves/deletes/edits
to existing content docs. Consolidation proposals are proposals only — execution is a
separate issue. `docs/ADR/` is excluded from all consolidation proposals (immutable
history).

**Methodology:** 3-axis parallel audit — (1) folder characterization + generation markers,
(2) reachability / orphan detection, (3) duplication / overlap / consolidation candidates.

**Idempotency:** Content is deterministic (no timestamps, stable ordering). Re-running
`node scripts/gen-doc-index.mjs` after this commit yields a byte-identical `docs/INDEX.md`.
Counts are pinned as-of this commit.

---

## 1. Inventory Summary

**332 `.md` files** total under `docs/`. (Counts below are `.md` only — `audits/` also
has 2 `.json`, `METHOD/` has 2 `.arbiter-backup`, `SYSTEM/` has 1 `.json`; these are
excluded from `.md` counts.)

| Folder                       | .md count | Notes                                                              |
| ---------------------------- | --------- | ------------------------------------------------------------------ |
| `docs/ADR/`                  | 91        | 88 numbered ADRs + 2 templates + README                            |
| `docs/api/`                  | 1         | Single README                                                      |
| `docs/architecture/`         | 8         |                                                                    |
| `docs/audits/`               | 8         | + 2 .json (kit-canonical-mapping, planning-skeleton-inventory)     |
| `docs/case-studies/`         | 8         | includes `case-studies/incidents/` subfolder                       |
| `docs/COMMUNITY/`            | 1         |                                                                    |
| `docs/DEVELOPMENT/`          | 4         |                                                                    |
| `docs/GOVERNANCE/`           | 8         |                                                                    |
| `docs/i18n/`                 | 1         |                                                                    |
| `docs/install/`              | 1         |                                                                    |
| `docs/internal/`             | 5         |                                                                    |
| `docs/METHOD/`               | 14        | + 2 `.arbiter-backup` (ENGINEERING_DEFAULTS, SSOT_CORE_SET)        |
| `docs/MIGRATION/`            | 4         |                                                                    |
| `docs/plans/`                | 1         |                                                                    |
| `docs/PRODUCT/`              | 15        |                                                                    |
| `docs/REFERENCE/`            | 123       | 31 cards + 77 `coverage/dim-NN` + 16 `recipes/` + 4 redirect stubs |
| `docs/rfc/`                  | 3         |                                                                    |
| `docs/runbooks/`             | 5         |                                                                    |
| `docs/SECURITY/`             | 3         |                                                                    |
| `docs/SYSTEM/`               | 11        | + 1 `.json` (branch-protection-snapshot)                           |
| `docs/testing/`              | 1         |                                                                    |
| **Loose files (docs/ root)** | **16**    | See §3                                                             |
| **TOTAL**                    | **332**   |                                                                    |

---

## 2. Per-Folder Characterization

### Subdirectories

| Folder               | PURPOSE                                                                                                     | GEN-STATUS   | MARKER / GENERATOR                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------- |
| `docs/ADR/`          | Architectural Decision Records (ADR-001–ADR-088) with rationale; flat; immutable history                    | hand-written | none (6 prose false-positives inside ADR bodies)                                                          |
| `docs/api/`          | Public API reference spine; points to api-extractor generated snapshots under `../../api/`                  | hand-written | none                                                                                                      |
| `docs/architecture/` | System architecture: canonical-source model, dual-track, evidence-bundle, template system                   | hand-written | none                                                                                                      |
| `docs/audits/`       | Point-in-time gap/coverage audits (dated .md + 2 JSON inventories)                                          | hand-written | none                                                                                                      |
| `docs/case-studies/` | arbiter dogfooding narratives + `incidents/` subfolder                                                      | hand-written | none                                                                                                      |
| `docs/COMMUNITY/`    | Community discussions guide                                                                                 | hand-written | none                                                                                                      |
| `docs/DEVELOPMENT/`  | Contributor onboarding: conventions, getting-started, testing strategy                                      | hand-written | none                                                                                                      |
| `docs/GOVERNANCE/`   | Project governance: RACI, labels, CoC runbook, good-first-issue policy                                      | hand-written | none                                                                                                      |
| `docs/i18n/`         | Translation/localization contributing guide                                                                 | hand-written | none                                                                                                      |
| `docs/install/`      | Platform install notes (`windows.md` / WSL2)                                                                | hand-written | none                                                                                                      |
| `docs/internal/`     | Internal ops: release playbook, QA/mutation/mobile checklists; **NOT committed to public repo**             | hand-written | none                                                                                                      |
| `docs/METHOD/`       | Methodology / SSOT specs: context packs, knowledge map, reuse registry, track model, SSOT core set          | hand-written | none                                                                                                      |
| `docs/MIGRATION/`    | Migration guides between config/deploy/backend versions                                                     | hand-written | none                                                                                                      |
| `docs/plans/`        | Planning artifacts (skeleton-migration-plan)                                                                | hand-written | none                                                                                                      |
| `docs/PRODUCT/`      | Product strategy: PRD, competition, feature matrices, milestones, presets                                   | hand-written | none                                                                                                      |
| `docs/REFERENCE/`    | Technical reference cards + `coverage/` (77 dim-NN docs) + `recipes/` (16 how-to guides) + 4 redirect stubs | **MIXED**    | 4 files: `> This file is intentionally a redirect stub. Do not edit...` → `website/reference/*`           |
| `docs/rfc/`          | RFC process: template + plugin-api-v2 RFC + README                                                          | hand-written | none                                                                                                      |
| `docs/runbooks/`     | Operational runbooks: deploy, rollback, prod-checklist, dependabot, troubleshooting                         | hand-written | none                                                                                                      |
| `docs/SECURITY/`     | Security artifacts: STRIDE threat register, risk assessment, ISO27001 Annex A control matrix                | hand-written | none                                                                                                      |
| `docs/SYSTEM/`       | System contracts: CANON, CI tiers, hook model, workflow model, fail-closed model                            | **MIXED**    | `DECISIONS.md` is generated (`status: generated`); digest of `docs/ADR/` via `scripts/gen-adr-readme.mjs` |
| `docs/testing/`      | Single post-merge review template                                                                           | hand-written | none                                                                                                      |

### REFERENCE/ Internal Structure (123 files)

Three tiers:

1. **Top-level reference cards (~31 files)** — mixed naming: SCREAMING-CASE for canonical
   surfaces (`AGENT_RULES.md`, `BLAME.md`, `GLOBAL_KIT.md`, `RESILIENCE.md`) and kebab-case
   for topic guides (`ai-pr-gate.md`, `backward-compat-harness.md`, `stack-adapter-contract.md`).
   **4 files are redirect stubs** (intentional drift-prevention, not content):
   `CLI.md`, `HOOKS.md`, `TEMPLATES.md`, `STACK-SUPPORT.md` → `website/reference/*`.

2. **`coverage/` subfolder — 77 files** named `dim-NN-<slug>.md` (dim-01 … dim-77), one per
   quality dimension in arbiter's taxonomy (hexagonal architecture, mutation testing, SBOM, a11y,
   audit-log DDL, etc.). Highly regular; hand-written; cross-linked from `REFERENCE/GLOBAL_KIT.md`.

3. **`recipes/` subfolder — ~16 files** — kebab-case how-to guides
   (`migrate-from-bmad.md`, `tdd-enforcement.md`, `monorepo-adoption.md`, `sibling-worktree.md`)
   plus its own `README.md`.

### ADR/ Internal Structure (91 files)

Flat folder, no subdirectories. **88 numbered ADRs** following `NNN-<kebab-slug>.md` from
`001-agents-md-canonical.md` through `088-ship-as-orchestration-entrypoint.md` — no gaps in
the sequence. Early ADRs (001–050) use short slugs; later ones (055+) have longer auto-derived
slugs suggesting title-based generation. Plus **3 non-numbered files**: `ADR-000_template.md`,
`ADR-TEMPLATE.md` (two template variants — **byte-duplicate body**, only frontmatter differs;
maintainer note: drift hazard), and `README.md` (declares `docs/ADR/` the canonical SSOT).

### Loose top-level files

| File                              | PURPOSE                                                                   | GEN-STATUS                                                   |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `docs/CHANNELS.md`                | Communication channels guide                                              | hand-written                                                 |
| `docs/CODING_STANDARDS.md`        | Coding standards template ("Update to match your team's")                 | hand-written                                                 |
| `docs/DEPRECATIONS.md`            | Deprecation tracking                                                      | hand-written                                                 |
| `docs/FAQ.md`                     | Frequently asked questions                                                | hand-written                                                 |
| `docs/INDEX.md`                   | Documentation index                                                       | **GENERATED** — `scripts/gen-doc-index.mjs` from frontmatter |
| `docs/INTEGRATIONS.md`            | Third-party integrations                                                  | hand-written                                                 |
| `docs/MASTER_TEST_PLAN.md`        | Master test plan (coverage thresholds + mandatory test patterns template) | hand-written                                                 |
| `docs/PLUGIN-API.md`              | Plugin API reference                                                      | hand-written                                                 |
| `docs/POSITIONING.md`             | Product positioning                                                       | hand-written                                                 |
| `docs/QUICKSTART.md`              | 5-minute install quickstart                                               | hand-written                                                 |
| `docs/SECURE_CODING_CHECKLIST.md` | Secure-coding checklist (generated PR-review checklist template)          | hand-written                                                 |
| `docs/SEMVER.md`                  | SemVer policy                                                             | hand-written                                                 |
| `docs/SETUP.md`                   | Setup instructions (arbiter-repo-itself)                                  | hand-written                                                 |
| `docs/sponsors.md`                | Sponsors list                                                             | hand-written                                                 |
| `docs/TESTING_POLICY.md`          | Testing policy: test pyramid + mock policy                                | hand-written                                                 |
| `docs/TEST_TAXONOMY.md`           | Test taxonomy: 26-dimension catalog + pyramid levels                      | hand-written                                                 |

---

## 3. Generated vs Hand-Written

Of the ~30 files the broad regex `auto-generated|do not edit|this file is generated|arbiter:generated`
matches, only **6 are genuinely generated/auto-managed**; the remainder are prose false-positives
(ADR bodies referencing generation workflows, methodology docs describing the convention, etc.).

| File                              | Generation status      | Generator                                              |
| --------------------------------- | ---------------------- | ------------------------------------------------------ |
| `docs/INDEX.md`                   | **GENERATED**          | `scripts/gen-doc-index.mjs` from doc frontmatter       |
| `docs/SYSTEM/DECISIONS.md`        | **GENERATED** (digest) | `scripts/gen-adr-readme.mjs` from `docs/ADR/`          |
| `docs/REFERENCE/CLI.md`           | **REDIRECT STUB**      | Manual; points to `website/reference/cli.md`           |
| `docs/REFERENCE/HOOKS.md`         | **REDIRECT STUB**      | Manual; points to `website/reference/hooks.md`         |
| `docs/REFERENCE/TEMPLATES.md`     | **REDIRECT STUB**      | Manual; points to `website/reference/templates.md`     |
| `docs/REFERENCE/STACK-SUPPORT.md` | **REDIRECT STUB**      | Manual; points to `website/reference/stack-support.md` |

Note: `docs/METHOD/REUSE_REGISTRY.md` contains the literal `arbiter:generated` only as
documentation describing the vault-file marker convention — the file itself is hand-written.

---

## 4. Reachability and Orphans

### INDEX.md coverage

`docs/INDEX.md` is auto-generated from frontmatter and links **331/332 docs (99.7%)**.
The only file it does not link is itself. It covers every folder without exception (including
all 77 `coverage/dim-NN` files and all 88 numbered ADRs).

### Strict orphans (no entry-point coverage)

**Zero.** Every doc is linked by at least one entry point. The entry points:

| Entry point                    | What it covers                                             |
| ------------------------------ | ---------------------------------------------------------- |
| `docs/INDEX.md`                | 331/332 docs                                               |
| `README.md` (repo root)        | POSITIONING, architecture, CLI ref, FAQ, PRODUCT, key ADRs |
| `docs/METHOD/KNOWLEDGE_MAP.md` | Line-range pointers into key files                         |
| `docs/SYSTEM/DECISIONS.md`     | All 88 numbered ADRs                                       |
| `docs/ADR/README.md`           | All 88 numbered ADRs                                       |
| `.claude/knowledge-map.json`   | Machine routing; references `docs/METHOD/KNOWLEDGE_MAP.md` |

### Soft orphans (reachable only via generated INDEX, no sibling cross-link)

27 files (8% of 332) have no inbound link from any sibling doc or folder README — they rely
solely on the generated `docs/INDEX.md` for discoverability.

| Folder            | Count   | Representative paths                                                                                                                                                                                                      |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/REFERENCE/` | 10      | `AGENT_RULES.md`, `BLAME.md`, `CODEX-PARITY.md`, `SELF-KIT-AUDIT.md`, `USE-CASE-MATRIX.md`, `backward-compat-harness.md`, `java-adapter.md`, `pact-provider-states.md`, `pharma-overlay.md`, `postman-newman-contract.md` |
| `docs/MIGRATION/` | 4 (all) | `config-versioning.md`, `decomposition-backends.md`, `deploy-config-consolidation.md`, `no-github-default.md`                                                                                                             |
| `docs/PRODUCT/`   | 4       | `EXTENDED-INVARIANTS.md`, `PRESETS.md`, `RELEASE-V1-TRACKING.md`, `TEST-PYRAMID-PROFILES.md`                                                                                                                              |
| `docs/SECURITY/`  | 2       | `ISO27001_ANNEX_A.md`, `RISK_ASSESSMENT.md`                                                                                                                                                                               |
| `docs/internal/`  | 2       | `mobile-responsiveness-checklist.md`, `release-playbook.md`                                                                                                                                                               |
| `docs/audits/`    | 2       | `cross-repo-kit-coverage-2026-05-29.md`, `dual-adr-cli-followup-2026-06-02.md`                                                                                                                                            |
| `docs/ADR/`       | 1       | `ADR-TEMPLATE.md`                                                                                                                                                                                                         |
| `docs/COMMUNITY/` | 1 (all) | `DISCUSSIONS.md`                                                                                                                                                                                                          |
| `docs/SYSTEM/`    | 1       | `FAIL_CLOSED.md`                                                                                                                                                                                                          |

Note: `coverage/dim-*` files are cross-linked from `docs/REFERENCE/GLOBAL_KIT.md` — not in
this list.

### Folder-level READMEs (exist)

`docs/ADR/README.md`, `docs/api/README.md`, `docs/architecture/README.md`,
`docs/GOVERNANCE/README.md`, `docs/GOVERNANCE/index.md`, `docs/REFERENCE/recipes/README.md`,
`docs/rfc/README.md`.

Folders without a folder README (rely on INDEX.md only): `docs/REFERENCE/` (root),
`docs/REFERENCE/coverage/`, `docs/audits/`, `docs/case-studies/`, `docs/COMMUNITY/`,
`docs/DEVELOPMENT/`, `docs/i18n/`, `docs/install/`, `docs/internal/`, `docs/METHOD/`,
`docs/MIGRATION/`, `docs/plans/`, `docs/PRODUCT/`, `docs/runbooks/`, `docs/SECURITY/`,
`docs/SYSTEM/`, `docs/testing/`.

### Dangling optional references

`.claude/knowledge-map.json` lists two optional docs that do not exist:
`docs/METHOD/FRONTEND_CONTEXT.md` and `docs/METHOD/BACKEND_CONTEXT.md`. These are
`optional_docs` so non-fatal, but worth noting.

---

## 5. Duplication and Overlap Clusters

### Cluster 1 — CoC Enforcement Runbook (2 files)

| File                                         | Notes                                                       |
| -------------------------------------------- | ----------------------------------------------------------- |
| `docs/GOVERNANCE/coc-enforcement-runbook.md` | Public runbook, 133 lines, frontmatter present              |
| `docs/internal/coc-enforcement-runbook.md`   | Private superset, 197 lines, "not committed to public repo" |

Overlap type: partial-overlap (same four-tier Contributor-Covenant ladder, same "Receiving a
Report" section; internal is the superset). Same filename in two trees = active drift hazard.
**Proposed target:** `docs/internal/` version as working canonical; `docs/GOVERNANCE/` version
reduced to public summary/pointer.
**Delta: 2 → 1, −1 file.**

### Cluster 2 — Test Pyramid (3 docs restating same concept)

| File                                    | Overlap content                                   |
| --------------------------------------- | ------------------------------------------------- |
| `docs/TESTING_POLICY.md`                | `## Test Pyramid` L1–L4 table + mock policy       |
| `docs/TEST_TAXONOMY.md`                 | `## Pyramid Levels` L1–L5 table + 26-dim taxonomy |
| `docs/PRODUCT/TEST-PYRAMID-PROFILES.md` | Per-archetype pyramid profiles                    |

Overlap type: partial-overlap (the L1–L4/L5 pyramid table is defined three times with diverging
level labels).
**Proposed target:** `docs/TEST_TAXONOMY.md` as canonical level definition; `docs/TESTING_POLICY.md`
references it for the level table (keeps only mock/coverage policy locally); `TEST-PYRAMID-PROFILES`
links base taxonomy instead of re-stating levels.
**Delta: 0–1 file deleted (conservative: fold duplicated sections, retain files as cross-refs).**

### Cluster 3 — Root Testing Sprawl (MASTER_TEST_PLAN + TESTING_POLICY)

| File                       | Notes                                                                        |
| -------------------------- | ---------------------------------------------------------------------------- |
| `docs/MASTER_TEST_PLAN.md` | Generated template: coverage thresholds + mandatory test patterns (57 lines) |
| `docs/TESTING_POLICY.md`   | Pyramid + mock policy (81 lines)                                             |

Both are "what tests to write" template docs; `docs/DEVELOPMENT/TESTING-STRATEGY.md` (arbiter-self
structure) and `docs/TEST_TAXONOMY.md` (catalog) are distinct and stay.
**Proposed target:** merge `MASTER_TEST_PLAN.md` into `TESTING_POLICY.md`.
**Delta: 2 → 1, −1 file.**

### Cluster 4 — Evidence Bundle Schema (2 files)

| File                                   | Notes                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `docs/architecture/evidence-bundle.md` | Architecture framing of the schema, arbiter-internal audience                |
| `docs/REFERENCE/evidence-schema.md`    | Same schema (`schemas/evidence-bundle.schema.json`), target-project audience |

Same INV-90, same gate script `check-evidence-bundle.mjs` described in both.
**Proposed target:** `docs/REFERENCE/evidence-schema.md` as canonical schema reference;
`docs/architecture/evidence-bundle.md` retains architecture rationale + pointer to REFERENCE doc.
**Delta: effectively −1 (schema body duplication removed; both files kept with distinct roles).**

### Cluster 5 — Public API Reference (2 files)

| File                    | Notes                                                   |
| ----------------------- | ------------------------------------------------------- |
| `docs/api/README.md`    | API spine; points to api-extractor snapshots (51 lines) |
| `docs/REFERENCE/api.md` | Full human-authored Public API Reference, 207 lines     |

Both document the public API surface / entry points.
**Proposed target:** `docs/REFERENCE/api.md` as canonical reference; `docs/api/README.md`
reduced to pointer to generated snapshots + link to `docs/REFERENCE/api.md`.
**Delta: 2 → 1 effective, −1 (api/README becomes thin pointer).**

### Cluster 6 — Coding Standards vs Conventions (flagged, not proposed for merge)

| File                              | Notes                                                      |
| --------------------------------- | ---------------------------------------------------------- |
| `docs/CODING_STANDARDS.md`        | Generic generated template ("Update to match your team's") |
| `docs/DEVELOPMENT/CONVENTIONS.md` | arbiter-specific contributor conventions                   |

Partial overlap (both are "dev style rules") but different audiences (generated-target vs
arbiter-contributor). Conservative proposal: cross-link only, prevent drift on shared rules.
**Delta: 0.**

---

## 6. Consolidation Candidates Summary

ADR/ excluded from all proposals (immutable history).

| Cluster                 | Canonical target                           | Fold in                                                                             | Delta                |
| ----------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------- | -------------------- |
| 1 — CoC runbook         | `docs/internal/coc-enforcement-runbook.md` | `docs/GOVERNANCE/coc-enforcement-runbook.md` → pointer                              | −1                   |
| 2 — Test pyramid        | `docs/TEST_TAXONOMY.md`                    | fold duplicate pyramid tables from `TESTING_POLICY.md` + `TEST-PYRAMID-PROFILES.md` | 0 files, −2 sections |
| 3 — Root testing sprawl | `docs/TESTING_POLICY.md`                   | `docs/MASTER_TEST_PLAN.md`                                                          | −1                   |
| 4 — Evidence bundle     | `docs/REFERENCE/evidence-schema.md`        | schema body from `docs/architecture/evidence-bundle.md`                             | −1 section           |
| 5 — Public API          | `docs/REFERENCE/api.md`                    | `docs/api/README.md` → thin pointer                                                 | −1                   |
| 6 — Coding standards    | cross-link only                            | n/a                                                                                 | 0                    |

**Conservative total: −4 files, −2 sections (excluding ADR).**

### ADR template note (excluded from proposals)

`docs/ADR/ADR-000_template.md` and `docs/ADR/ADR-TEMPLATE.md` have byte-identical bodies
(only frontmatter `title`/`status` differ). True duplicate inside `docs/ADR/` — excluded from
consolidation per scope, but flagged as a maintainer drift hazard.

### Explicit NOT-overlap

The following surface as multi-file topics but are **not** overlap — each file has a distinct
purpose or audience:

- **Security (5 files):** `SECURE_CODING_CHECKLIST.md` (PR checklist template), `SECURITY/STRIDE.md`
  (threat register), `SECURITY/RISK_ASSESSMENT.md` (ISO 27001 P×I), `SECURITY/ISO27001_ANNEX_A.md`
  (control matrix), `REFERENCE/supply-chain.md` (INV-92 SC pipeline) — 5 distinct security facets.
- **CI tiers (5 files):** `SYSTEM/CI-TIER-MODEL.md` (design spec), `REFERENCE/ci-tier-workflows.md`
  (workflow inventory), `REFERENCE/cicd-developer-reference.md` (W4 self-CI), `SYSTEM/CI-MIGRATION.md`
  (migration guide), `REFERENCE/nightly-weekly-heartbeat.md` (tier detail) — index-vs-detail layering.
- **Setup / install (4 files):** `SETUP.md` (arbiter-repo), `QUICKSTART.md` (5-min install),
  `DEVELOPMENT/GETTING-STARTED.md` (dev env), `install/windows.md` (WSL2) — different audiences.
- **REUSE_REGISTRY vs REUSE_REGISTRY_SPEC** — spec defines format, registry is the data instance.
- **FEATURE_COMPARISON vs FEATURE_MATRIX vs COMPETITION** — vs-competitors / internal RTM (gated)
  / competitive landscape — three distinct purposes.
- **GOVERNANCE index vs README** — `GOVERNANCE/index.md` (canonical spine) + `GOVERNANCE/README.md`
  (GitHub-directory pointer) — intentional index/pointer pattern.

---

## 7. Go/No-Go Scaffold (Phase 2 Authorization)

Fill in before executing any consolidation. One row per area. Phase-2 = separate issue.

| Area                                          | Files affected    | Risk                                      | Recommendation                                  | Go / No-go |
| --------------------------------------------- | ----------------- | ----------------------------------------- | ----------------------------------------------- | ---------- |
| Cluster 1 — CoC runbook merge                 | 2                 | Low (both hand-written prose, same topic) | Merge; internal as canonical                    |            |
| Cluster 2 — Test pyramid table dedup          | 3 (sections only) | Low                                       | Fold duplicate tables; retain all 3 files       |            |
| Cluster 3 — MASTER_TEST_PLAN → TESTING_POLICY | 2 → 1             | Low                                       | Merge                                           |            |
| Cluster 4 — Evidence bundle dedup             | 2 (one section)   | Low                                       | Fold schema body; both files retained           |            |
| Cluster 5 — api/README → pointer              | 2 → thin          | Low                                       | `api/README.md` becomes pointer                 |            |
| Cluster 6 — Standards/conventions cross-link  | 2 (links only)    | None                                      | Cross-link only                                 |            |
| Soft orphans — add cross-links                | 27                | Low                                       | Progressive; prioritize MIGRATION/ + COMMUNITY/ |            |
| `docs/METHOD/FRONTEND_CONTEXT.md` (missing)   | 0                 | Low                                       | Create stub or remove from knowledge-map.json   |            |
| `docs/METHOD/BACKEND_CONTEXT.md` (missing)    | 0                 | Low                                       | Create stub or remove from knowledge-map.json   |            |
| ADR template byte-dup                         | 0 (excluded)      | None                                      | Maintainer note only                            | —          |
