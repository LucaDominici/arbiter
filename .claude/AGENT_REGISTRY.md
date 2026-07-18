---
title: 'Agent Registry'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# Agent Registry

Canonical index of all sub-agents available to Claude Code in this repo.
Source of truth: `.claude/agents/<name>.md`. Update this file whenever an agent is added, modified, or removed.

---

## Agents

| Agent              | Model                 | Effort | Cost Rationale                                                                                    |
| ------------------ | --------------------- | ------ | ------------------------------------------------------------------------------------------------- |
| `ai-pr-gate`       | Default (Sonnet)      | Low    | Read-only INV-91 compliance check; scans PR labels + reviewer identity; fast and targeted         |
| `bridge-reviewer`  | Default (Sonnet)      | Low    | Short-circuit combinatorial logic; no code reading required; runs after context-checker completes |
| `codebase-scanner` | Haiku                 | Low    | Read-only pattern search; fast latency; cost-optimized for high-frequency lookups                 |
| `context-checker`  | Default (Sonnet)      | Medium | Must read CONTEXT_PACK.md + task diff in full; emits structured REVIEW_CONTEXT JSON               |
| `red-team`         | Default (Sonnet/Opus) | High   | Adversarial multi-vector analysis; deep code reasoning; runs pre-merge on complex changes         |

---

## Interaction Chains

### Task start

1. Read issue → classify tier → `red-team` (pre-plan, Phase 2.7)
2. Implementation begins → `codebase-scanner` for pattern lookups as needed

### Task completion (pre-merge)

1. Code complete → `codebase-scanner` (verify no duplicate symbols)
2. `context-checker` (Phase 1 verification)
3. `bridge-reviewer` (Phase 2 combined verdict)
4. Standard review agents dispatched per tier (XS: 3, S: 3, Standard: 4)

### Bot-authored PR review

1. `ai-pr-gate` (INV-91: verify approved-by-human label + human reviewer identity)
2. Proceed to merge only after PASS verdict

### E2E test failure

1. `codebase-scanner` (locate test + source files)
2. `red-team` (if failure looks like invariant violation or data-integrity issue)

### Gate failure

1. `codebase-scanner` (find the violating pattern)
2. Fix → re-run gate — no agent needed for straightforward lint/type failures

### Library / dependency lookup

1. `codebase-scanner` (check existing usage patterns in repo before adding new dep)

### Migration (language/framework upgrade)

1. `codebase-scanner` (enumerate all call sites)
2. `red-team` (assess breaking-change blast radius)
3. `context-checker` + `bridge-reviewer` after migration complete

---

## Escalation Hierarchy

```
codebase-scanner  →  context-checker  →  bridge-reviewer
                                       ↑
                        red-team (parallel, pre-plan or pre-merge)
```

- Start with `codebase-scanner` for any "does X exist?" question (fast, cheap).
- Escalate to `context-checker` only when you need a structured INV/CANON verdict.
- `bridge-reviewer` runs only after `context-checker` completes (requires its output).
- `red-team` runs in parallel with planning, not sequentially — it gates the plan, not the code review.

---

## Adding / Removing Agents

1. Create or delete `.claude/agents/<name>.md`
2. Update this registry (add/remove row + chain entries)
3. Update `.claude/rules/05-agent-lifecycle.md` if the agent affects always-loaded rules
4. Append an ADR-style entry to `docs/internal/SYSTEM/DECISIONS.md`
