---
title: Governance
---

# arbiter Governance

arbiter is governed by the same framework it ships. This page surfaces the key
governance artifacts so contributors and adopters can see exactly how the rules
are applied and enforced.

## Canonical documents

| Document                                                                             | Purpose                                                                               |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| [AGENTS.md](https://github.com/LucaDominici/arbiter/blob/main/AGENTS.md)             | Machine-readable invariant catalog — consumed by Claude Code hooks and the L1/L2 gate |
| [CANON.md](https://github.com/LucaDominici/arbiter/blob/main/docs/SYSTEM/CANON.md)   | 15 process-level rules derived from audit waves #151–#186                             |
| [RACI.md](https://github.com/LucaDominici/arbiter/blob/main/docs/GOVERNANCE/RACI.md) | Responsibility matrix for governance decisions                                        |

## Architecture Decision Records

| ADR                                                                                              | Title           | Status   |
| ------------------------------------------------------------------------------------------------ | --------------- | -------- |
| [ADR-001](https://github.com/LucaDominici/arbiter/blob/main/docs/adr/ADR-001_task-workflow.md)   | Task workflow   | Accepted |
| [ADR-002](https://github.com/LucaDominici/arbiter/blob/main/docs/adr/ADR-002_gate-tiers.md)      | Gate tiers      | Accepted |
| [ADR-003](https://github.com/LucaDominici/arbiter/blob/main/docs/adr/ADR-003_docs-site-ia.md)    | Docs site IA    | Accepted |
| [ADR-004](https://github.com/LucaDominici/arbiter/blob/main/docs/adr/ADR-004_docs-versioning.md) | Docs versioning | Accepted |

## Self-governance case studies

- [arbiter governs arbiter](https://github.com/LucaDominici/arbiter/blob/main/docs/case-studies/arbiter-itself.md) — the recursive case
- [Evidence trail](https://github.com/LucaDominici/arbiter/blob/main/docs/case-studies/arbiter-itself-evidence.md) — public knowledge map snapshot
- [Nightly canary](https://github.com/LucaDominici/arbiter/blob/main/docs/case-studies/arbiter-itself-canary.md) — drift detection

## How decisions are made

Governance changes follow the same path as code changes:

1. Issue opened with `governance` label
2. Red-team review before plan is approved
3. CANON-NN compliance checked at plan phase
4. Gate must be GREEN before merge (no `--no-verify` exceptions)
