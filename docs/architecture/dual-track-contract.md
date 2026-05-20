---
title: Dual-Track Contract
type: architecture
status: active
date: 2026-05-19
issue: '#876'
doc_version: '1.0.0'
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/method', 'scope/dual-track']
related: []
---

# Dual-Track Contract

> Every framework capability ships two tracks simultaneously.
> Neither track alone is acceptable.
> Violations block PR merge via `pre-edit-plan-anchor.mjs` + CANON enforcement.

---

## The Contract

For every new engineering skeleton capability added to arbiter:

**Track A — arbiter-for-itself**
The capability is applied to the arbiter repository directly.
Arbiter eats its own cooking.

**Track B — arbiter-as-framework**
The same capability is encoded once-and-for-all as reusable framework artifacts.
Any project that runs `arbiter init` inherits the equivalent capability without copy-paste.

Both tracks ship in the **same PR** on the **same branch**. Split PRs are a violation.

---

## Track B Sub-Tracks

Track B has four sub-tracks. Not all four are required for every capability — the wave matrix specifies which apply.

| Sub-track | What it is                                                                     | Required when                                         |
| --------- | ------------------------------------------------------------------------------ | ----------------------------------------------------- |
| **B1**    | EJS template under `src/templates/`                                            | Capability produces a generated file                  |
| **B2**    | Generator under `src/generators/*.ts`                                          | B1 template needs rendering logic or parameterization |
| **B3**    | KIT reference doc under `docs/REFERENCE/`                                      | Capability maps to ≥1 KIT dim                         |
| **B4**    | Invariant or gate entry in `src/invariants/catalog.ts` or `src/kit/catalog.ts` | Capability has a machine-enforceable contract         |

If a capability is docs-only (no template, no gate), B1/B2/B4 may be omitted — but B3 is always required.

---

## Wave Matrix Template

Every wave in `docs/plans/planning-skeleton-migration-plan.md` fills in this table:

| Deliverable           | Track A path            | B1 template path                          | B2 generator                              | B3 doc path                    | B4 catalog entry |
| --------------------- | ----------------------- | ----------------------------------------- | ----------------------------------------- | ------------------------------ | ---------------- |
| (example) gate script | `scripts/check-foo.mjs` | `src/templates/scripts/check-foo.mjs.ejs` | `src/generators/anti-drift-validators.ts` | `docs/REFERENCE/dim-NN-foo.md` | INV-NN           |
| (fill per wave)       |                         |                                           |                                           |                                |                  |

---

## Canonical Examples

### Example: Local Wrapper (W3)

| Track | Deliverable                                                      |
| ----- | ---------------------------------------------------------------- |
| A     | `Makefile` + `run.sh` in arbiter root                            |
| A     | `scripts/check-local-ci-parity.mjs` (verifies Makefile↔CI drift) |
| B1    | `src/templates/local-wrapper/Makefile.ejs`                       |
| B1    | `src/templates/local-wrapper/run.sh.ejs`                         |
| B2    | `src/generators/local-wrapper.ts`                                |
| B3    | `docs/REFERENCE/local-wrapper-contract.md`                       |
| B4    | INV-87 in `src/invariants/catalog.ts`                            |

### Example: CI Tier Baseline (W4)

| Track | Deliverable                                             |
| ----- | ------------------------------------------------------- |
| A     | `.github/workflows/01-pr-fast.yml`                      |
| A     | `.github/workflows/02-pr-extended.yml`                  |
| B1    | `src/templates/github/workflows/01-pr-fast.yml.ejs`     |
| B1    | `src/templates/github/workflows/02-pr-extended.yml.ejs` |
| B2    | `src/generators/github-workflows.ts` (extend)           |
| B3    | `docs/REFERENCE/ci-tier-workflows.md`                   |
| B4    | INV-73 status update in catalog                         |

### Example: KIT Canonical SSOT (W2)

| Track | Deliverable                                             |
| ----- | ------------------------------------------------------- |
| A     | `src/kit/{taxonomy,catalog,index}.ts`                   |
| A     | `scripts/check-kit-catalog-parity.mjs`                  |
| B1    | `src/templates/kit/*.ejs`                               |
| B2    | `src/generators/kit.ts`                                 |
| B3    | `docs/REFERENCE/dim-001-*.md … dim-076-*.md` (76 files) |
| B4    | INV-86 in catalog                                       |

### Example: Anti-Drift Validator (W6)

| Track | Deliverable                                                           |
| ----- | --------------------------------------------------------------------- |
| A     | `scripts/check-workflow-sha-pinning.mjs`                              |
| B1    | `src/templates/scripts/anti-drift/check-workflow-sha-pinning.mjs.ejs` |
| B2    | `src/generators/anti-drift-validators.ts`                             |
| B3    | `docs/REFERENCE/anti-drift-family.md`                                 |
| B4    | INV-89 (every validator must support `--help`)                        |

---

## Enforcement Mechanisms

| Mechanism                       | What it catches                                                           | CANON rule                              |
| ------------------------------- | ------------------------------------------------------------------------- | --------------------------------------- |
| `pre-edit-plan-anchor.mjs` hook | Edit attempted without plan-anchor commit during IMPL phases              | CANON-14                                |
| `check-no-orphan-todo.mjs` hook | Half-finished B-track with `TODO(#NNN)` missing from plan                 | CANON-09                                |
| `post-edit-dispatch.mjs` hook   | Format + lint after any file edit; catches B-track template regressions   | CANON-04                                |
| CANON-04                        | New/edited EJS template without dual-track check in plan                  | `.claude/rules/30-canon-enforcement.md` |
| CANON-05                        | New/edited generator without template counterpart                         | `.claude/rules/30-canon-enforcement.md` |
| CANON-11                        | Generator that writes files without a template                            | `.claude/rules/30-canon-enforcement.md` |
| Gate (INV-86)                   | Kit catalog dims with BLOCKING gate_type but no B4 invariant or validator | `scripts/check-kit-catalog-parity.mjs`  |

---

## Anti-Patterns

| Anti-pattern                                                   | Why it violates the contract                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| "I'll add the template later"                                  | B1 deferred = Track B incomplete = violation on merge                     |
| "The arbiter-self version is enough"                           | Framework consumers get nothing; defeats arbiter's mission                |
| "The template is enough; I won't apply it to arbiter's own CI" | Track A incomplete; arbiter cannot dogfood its own patterns               |
| Split PRs (A in one PR, B in another)                          | Invariants in A reference templates in B that don't exist yet; gate fails |
| B3-only (docs without enforcement)                             | Acceptable only for `REFERENCE` gate-type dims; BLOCKING dims need B4     |

---

## Scope Boundaries

The dual-track contract applies to:

- Gate scripts (any `scripts/check-*.mjs` that is part of the skeleton harness)
- CI workflows (any `.github/workflows/*.yml`)
- Local wrapper targets (Makefile, run.sh)
- Stack adapter capabilities (any `src/adapters/*.ts` method that emits harness artifacts)
- KIT catalog dims with `arbiter_target_kind` ≠ `adapter`

The dual-track contract does NOT apply to:

- Arbiter-internal TypeScript modules with no framework output (e.g., `src/detectors/*.ts`)
- One-off scripts under `scripts/` that are exclusively for arbiter's own repo management
- ADRs and decision logs (docs-only, no framework output needed)
- Test fixtures under `__tests__/` (not emitted to target projects)

---

## References

- `docs/architecture/skeleton-governance.md` — primitive taxonomy and architecture Q&A
- `docs/plans/planning-skeleton-migration-plan.md` — wave-by-wave dual-track matrix
- `AGENTS.md §Invariants` — INV-73, INV-86..INV-93
- `.claude/rules/30-canon-enforcement.md` — CANON-04/05/07/11/13/14/15
