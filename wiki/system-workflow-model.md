---
generated: true
source: 'docs/SYSTEM/WORKFLOW-MODEL.md'
source_sha: 'ff72d51df98c6b9c08d0de1602c145dead5a72bd'
last_updated: '2026-06-08'
---

# Arbiter Workflow Model

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/SYSTEM/WORKFLOW-MODEL.md](../docs/SYSTEM/WORKFLOW-MODEL.md)

# Arbiter Workflow Model

This document is the single-file synthesis of how arbiter's collaboration-mode axis
determines branching strategy, CI shape, and merge policy for scaffolded projects.

**ADR cross-references:** ADR-051 (collaboration-mode axis), ADR-050 (pipeline tiers).

---

## Collaboration Mode Axis

The primary driver for branching and CI shape is `collaborationMode`, not team size.
Team size is a friendly UX proxy in the wizard; the config stores `collaborationMode` only.

| `collaborationMode` | Trust model                    | Default branching | CI shape                 |
| ------------------- | ------------------------------ | ----------------- | ------------------------ |
| `trunk-solo`        | One author; signature = author | `trunk-direct`    | T1 + T4-lite nightly     |
| `peer-review`       | 1+ reviewers, shared trust     | `github-flow`     | T1 + T2 + T4 nightly     |
| `gated-review`      | CODEOWNERS + attestation chain | `github-flow`     | T1 + T2 + T4 + T5 weekly |

See ADR-051 for the full governance × collaboration coherence matrix (12 cells).

---

## Diagram 1 — Branching Flow per Collaboration Mode

```mermaid
flowchart LR
    subgraph TS[trunk-solo]
        TS_dev[edit in worktree] --> TS_gate[local gate]
        TS_gate -- pass --> TS_rebase[rebase on origin/main]
        TS_rebase --> TS_ff[git merge --ff-only]
        TS_ff --> TS_push[git push origin main]
    end
    subgraph PR[peer-review]
        PR_dev[edit in WT] --> PR_gate[local gate]
        PR_gate --> PR_pr[gh pr create]
        PR_pr --> PR_ci[PR CI T1+T2]
        PR_ci --> PR_review[1+ reviewer]
        PR_review --> PR_merge[gh pr merge --merge ff-only]
    end
    subgraph GR[gated-review]
        GR_dev[edit in WT] --> GR_gate[local gate]
        GR_gate --> GR_pr[gh pr create]
        GR_pr --> GR_ci[PR CI T1+T2]
        GR_ci --> GR_owners[CODEOWNERS approve]
        GR_owners --> GR_human[human-approval label]
        GR_human --> GR_merge[ff-only merge + cosign attest]
    end
```

---

## Diagram 2 — Check Ladder (Tiered)

```mermaid
flowchart TB
    subgraph L0[L0 pre-commit — advisory]
        L0_fmt[format staged]
        L0_lint[lint changed]
        L0_leaks[gitleaks staged]
        L0_hooks[PostToolUse hooks]
    end
    subgraph L1[L1 pre-push — advisory]
        L1_tc[typecheck full]
        L1_unit[unit affected]
        L1_inv[INV checks]
    end
    subgraph L2[L2 PR-CI — authoritative]
        L2_full[full unit + lint + tc]
        L2_int[integration]
        L2_debt[debt gates]
        L2_sec[gitleaks + dep-review]
    end
    subgraph L3[L3 nightly — authoritative]
        L3_e2e[E2E]
        L3_mut[mutation]
        L3_dog[dogfood + real-project matrix]
    end
    L0 -.advisory token.-> L1
    L1 -.advisory token.-> L2
    L2 --> L3
```

CI does NOT trust the local token for skip decisions — it re-runs all checks.
The token is for local provenance/audit only (`arbiter doctor`).

---

## Pipeline Style Table

`(collaborationMode × governanceLevel) → pipelineStyle`

|        | trunk-solo | peer-review | gated-review |
| ------ | ---------- | ----------- | ------------ |
| **L1** | starter    | starter     | standard     |
| **L2** | starter    | standard    | standard     |
| **L3** | standard   | standard    | industrial   |
| **L4** | standard   | standard    | industrial   |

Source: `src/config/collaboration-mode-defaults.ts`.

---

## Migration FAQ

**Q: My project has `soloDevMode: true` in arbiter.json. What do I do?**

Run `arbiter update`. It detects `soloDevMode: true` and writes
`collaborationMode: 'trunk-solo'` automatically. The `soloDevMode` field remains
for one minor release, then will be removed.

**Q: Can I override the pipelineStyle independently of collaborationMode?**

Yes. Set `pipelineStyle` directly in `arbiter.json`. The generator uses explicit
`pipelineStyle` before consulting the collaborationMode table.

**Q: What is `branchingStrategy`?**

A derived field resolved by the generator — not set manually. It controls whether
EJS templates emit `develop`-branch triggers. Most projects use `github-flow`
(branches: `[main, "task/**"]`). Only opt-in gated-review projects use
`github-flow-with-develop`.

**Q: What happens if I set `L4 + trunk-solo`?**

The wizard rejects this combination with a remediation prompt. L4 requires
CODEOWNERS + human-approval attestation, which is incoherent with `direct` merge.
Switch to `peer-review` or downgrade to L3.
