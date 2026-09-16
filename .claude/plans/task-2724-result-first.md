---
files:
  - src/commands/task-ship.ts
  - src/commands/task.ts
  - src/commands/task-state.ts
  - src/commands/ship-tier.ts
  - src/commands/ship-review.ts
  - src/commands/task-record-red.ts
  - src/evidence/git-checks.ts
  - scripts/check-all.mjs
  - scripts/record-agent-return.mjs
  - scripts/check-review-completion.mjs
  - .claude/hooks/stop-evidence-guard.mjs
---

# #2724 — One result-first delivery contract

Programme and durable continuation entry point: https://github.com/LucaDominici/arbiter/issues/2684.
This issue implements the approved Ship repair; it does not replace the complete convergence programme or establish comparative superiority.

## Context

- Base branch: `origin/main`, observed `220c193d10e84b77a1ee4681d8be4fe81c990592`.
- Reuse branch `task/#2724-ship-ceremony-cut`; preserve the owner-modified primary checkout.
- Key constraints: existing lifecycle, evidence stores, native ownership and landing; unchanged quality/security/debt thresholds; one writer and independent final review.
- Risk: obsolete policy in another entrypoint can silently restore ceremony or weaken an obligation. Trace callers and propagate templates before final qualification.
- Unit: one deliverable capability; three implementation parts (contract, early verification, distribution/proof), one landing candidate.

## Acceptance Criteria

- [ ] AC-1: ordinary work reaches TDD without a pre-code reviewer, plan-review evidence, second host-specific plan or forced handoff; direct lifecycle control enforces the same contract.
- [ ] AC-2: Ship, drain, driver, host instructions and completion guards consume the same obligations; retired evidence is not a hidden prerequisite.
- [ ] AC-3: repeated read-only status makes no remote query, state write or round increment; operational subject/risk changes refresh decisions conservatively.
- [ ] AC-4: one independent ordinary reviewer covers code, tests and distinct acceptance fit; sensitive risks select relevant specialists; missing AC proof blocks.
- [ ] AC-5: invalid frozen plans/subjects fail before dispatch; repeated dispatch is idempotent; a real post-fix round reviews the new candidate/delta.
- [ ] AC-6: one validated panel submission records the existing review and acceptance views; malformed, stale, partial or wrong-subject records cannot authorize acceptance; negative findings remain durable.
- [ ] AC-7: RED binds the actual committed test path across central, colocated and non-TS layouts; dirty/absent tests, Git errors or invalid execution cannot mint admissible proof.
- [ ] AC-8: cheap format/privacy/docs/dispatch/contract failures are reported together before costly suites; no qualifying receipt is produced.
- [ ] AC-9: preflight alone cannot authorize delivery; full qualification preserves required checks and exact-subject reuse/invalidation.
- [ ] AC-10: cold resume recovers candidate, observations and next action without broad rediscovery, invented RED, ritual clear or repeated qualification.
- [ ] AC-11: train affinity/exclusions, per-issue ACs, ownership/rollback and configured assurance/consent remain enforced.
- [ ] AC-12: source, templates, generated/installed consumers and docs agree; actual delivery verifies merge, required CI and applicable product proof. A real follow-on canary measures operation separately from competitive claims.

## Non-Goals

- No new orchestrator, evidence store, graph runtime, model router, logging backend or generic framework.
- No weaker tests, quality baselines or consent; no claim of universal correctness or optimality.
- No unrelated backlog implementation in this branch.

## Verification and execution

Use committed RED and focused GREEN at the CLI/state, recorder/guard and runner boundaries. Complete all fixes and generated propagation before freezing base, HEAD and AC identity. One independent final review covers the complete candidate and ACs; findings enter one fix batch. Run one successful final full local L2 on the unchanged subject, then PR/CI/merge. Review is not self-approval. A failed gate is diagnosed, not hidden or bypassed.

Historical replay and chronological TDD are distinct evidence classes. The earlier combined RED-path test/fix commit has a reported RED observation but does not itself establish a committed RED snapshot. Retain that limitation; do not rewrite history to imply otherwise.

Rollback is an atomic revert of the delivered change through normal repository delivery. The current lifecycle checkpoint names the next executable action; #2684 remains the cross-session programme entry point.
