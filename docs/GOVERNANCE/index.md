---
title: 'arbiter Governance'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/governance']
related: []
---

# arbiter Governance

arbiter is governed by the same framework it ships. This page surfaces the key
governance artifacts so contributors and adopters can see exactly how the rules
are applied and enforced.

---

## Canonical governance documents

| Document                                     | Purpose                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| [`AGENTS.md`](../../AGENTS.md)               | Machine-readable invariant catalog — consumed by Claude Code hooks and the L1/L2 gate |
| [`docs/SYSTEM/CANON.md`](../SYSTEM/CANON.md) | 15 process-level rules derived from audit waves #151–#186                             |
| [`docs/GOVERNANCE/RACI.md`](./RACI.md)       | Responsibility matrix for governance decisions                                        |
| [`docs/GOVERNANCE/LABELS.md`](./LABELS.md)   | Label catalogue — every label's consumer (no-consumer labels are removed)             |

## Architecture Decision Records

| ADR                                      | Title           | Status   |
| ---------------------------------------- | --------------- | -------- |
| [ADR-041](../ADR/041-task-workflow.md)   | Task workflow   | Accepted |
| [ADR-042](../ADR/042-gate-tiers.md)      | Gate tiers      | Accepted |
| [ADR-043](../ADR/043-docs-site-ia.md)    | Docs site IA    | Accepted |
| [ADR-044](../ADR/044-docs-versioning.md) | Docs versioning | Accepted |

## Self-governance case studies

- [arbiter governs arbiter](../case-studies/arbiter-itself.md) — the recursive case
- [Evidence trail](../case-studies/arbiter-itself-evidence.md) — public knowledge map snapshot
- [Nightly canary](../case-studies/arbiter-itself-canary.md) — drift detection
- [Incident case studies](../case-studies/incidents/) — invariants catching real issues

## How decisions are made

Governance changes follow the same path as code changes:

1. Issue opened with `governance` label
2. Red-team review before plan is approved
3. CANON-NN compliance checked at plan phase
4. Gate must be GREEN before merge (no `--no-verify` exceptions)

See [`docs/SYSTEM/CANON.md`](../SYSTEM/CANON.md) for the full decision protocol.
