---
generated: true
source: 'docs/STRUCTURE-AUDIT.md'
source_sha: 'd87e0266f5d4b71f0d3ac27b40250ab784d5fcf1'
last_updated: '2026-06-08'
---

# Docs Structure Audit

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/STRUCTURE-AUDIT.md](../docs/STRUCTURE-AUDIT.md)

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

| Folder               | PURPOSE                                                                                            | GEN-STATUS   | MARKER / GENERATOR                               |
| -------------------- | -------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------ |
| `docs/ADR/`          | Architectural Decision Records (ADR-001–ADR-088) with rationale; flat; immutable history           | hand-written | none (6 prose false-positives inside ADR bodies) |
| `docs/api/`          | Public API reference spine; points to api-extractor generated snapshots under `../../api/`         | hand-written | none                                             |
| `docs/architecture/` | System architecture: canonical-source model, dual-track, evidence-bundle, template system          | hand-written | none                                             |
| `docs/audits/`       | Point-in-time gap/coverage audits (dated .md + 2 JSON inventories)                                 | hand-written | none                                             |
| `docs/case-studies/` | arbiter dogfooding narratives + `incidents/` subfolder                                             | hand-written | none                                             |
| `docs/COMMUNITY/`    | Community discussions guide                                                                        | hand-written | none                                             |
| `docs/DEVELOPMENT/`  | Contributor onboarding: conventions, getting-started, testing strategy                             | hand-written | none                                             |
| `docs/GOVERNANCE/`   | Project governance: RACI, labels, CoC runbook, good-first-issue policy                             | hand-written | none                                             |
| `docs/i18n/`         | Translation/localization contributing guide                                                        | hand-written | none                                             |
| `docs/install/`      | Platform install notes (`windows.md` / WSL2)                                                       | hand-written | none                                             |
| `docs/internal/`     | Internal ops: release playbook, QA/mutation/mobile checklists; **NOT committed to public repo**    | hand-written | none                                             |
| `docs/METHOD/`       | Methodology / SSOT specs: context packs, knowledge map, reuse registry, track model, SSOT core set | hand-written | none                                             |
| `docs/MIGRATION/`    | Migration guides between config/deploy/backend versions                                            | hand-written | none                                             |
| `docs/plans/`        | Planning artifacts (skeleton-migration-plan)                                                       | hand-written | none                                             |
| `docs/PRODUCT/`      | Product s                                                                                          |

_[content truncated — see source for full text]_
