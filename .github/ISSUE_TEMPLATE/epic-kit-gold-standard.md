---
name: Epic — Cross-Stack Governance Kit
about: Sibling epic tracking Phases A-G of the cross-stack governance kit integration
title: 'Epic: Cross-stack governance kit (Phases A-G)'
labels: epic, kit
assignees: ''
---

<!-- HELD: Do NOT create this issue until the publish decision and Phase A.0 genericize-gate pass. See docs/internal/KIT-GOLD-STANDARD.md §7. -->

## Overview

Integrates a 76-dimension quality governance framework into arbiter as a cross-stack kit, covering architecture, static analysis, testing, CI/CD, security, scripts, documentation, configuration, and audit trail dimensions.

Each dimension has a TML level (L1 BLOCKING / L2 ADVISORY / L3 REFERENCE) and per-stack coverage derived from `cross-language-matrix.json` at build time.

## Phases

| Phase | Scope                                                                     | Status   |
| ----- | ------------------------------------------------------------------------- | -------- |
| A.0   | Genericize-gate spec + EPIC-A pre-flip scan integration + semver contract | open     |
| A     | Catalog SSOT + derive view + read-only CLI (PR #862)                      | complete |
| B     | Kit CLI mutating commands (`kit assess`, `kit wave N`)                    | open     |
| C     | Audit-trail opt-in (wizard `enableAuditTrail` + generators + INV-83/84)   | open     |
| D     | CI/CD developer-reference doc generator (multilingual)                    | open     |
| E     | Greenfield recipes + `arbiter kit greenfield <L>`                         | open     |
| F     | Brownfield `arbiter doctor kit` + wave playbook generator                 | open     |
| G     | Per-dim follow-up issues (decomposed from `kit list --format=csv`)        | open     |

## Phase A acceptance criteria (task #862)

- [x] `src/kit/catalog.json` — 76 dimensions, no per-stack fields, no employer fingerprints
- [x] `src/kit/overlay.json` — exception cells with `reason ≥ 40 chars`
- [x] `src/kit/category-map.json` — many-to-many kit category → matrix category
- [x] `src/kit/baseline.json` — TML + gap + matrix-ratio ratchet
- [x] `scripts/build-kit.mjs` — derives `src/kit/derived.json` from matrix + overlay
- [x] `scripts/check-no-redacted-tokens.mjs` — L1 gate (INV-85)
- [x] `scripts/check-private-paths-ignored.mjs` — L1 gate
- [x] Read-only CLI: `arbiter kit list|show|explain` behind `--experimental.kit`
- [x] CSV export via `--format=csv`
- [x] All 15 (stack × TML) grid cells have ≥1 covered dimension
- [x] Test suite: normalize, derive, catalog, redaction, reservations, CLI
- [x] INV-85 in `src/invariants/catalog.ts` + AGENTS.md
- [x] INV-82/83/84 reserved (comment + machine guard)

## Invariants reserved for this epic

| INV    | Title                  | Phase |
| ------ | ---------------------- | ----- |
| INV-82 | T5b heartbeat          | A.0   |
| INV-83 | Audit-append-only      | C     |
| INV-84 | Audit-trigger-presence | C     |

## Genericize-gate requirements (Phase A.0)

Before repo visibility flip (EPIC-A/B #576):

1. `check-no-redacted-tokens.mjs` green on all committed kit files
2. No employer fingerprints in any committed surface
3. No regulatory citations in any committed file
4. No literal proprietary framework name in CLI output or docs
5. `derived.json` shape documented for v1 EPIC-K stability

## Related

- Task #862 (Phase A implementation)
- EPIC-A/B #576 (repo visibility flip — must NOT precede genericize-gate pass)
- INV-85 (no kit source leakage — backs redaction gate)
