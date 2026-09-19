---
files:
  - .arbiter/evidence/tdd/#2724.json
  - .agents/CODEX.md
  - .agents/plan/PLAN.json
  - .agents/plan/README.md
  - .agents/rules/90-exec-protocol.md
  - .claude/CLAUDE.md
  - .claude/agent-dispatch-matrix.json
  - .claude/commands/drain.md
  - .claude/commands/impact.md
  - .claude/commands/review.md
  - .claude/commands/ship.md
  - .claude/hooks/exitplanmode-banner.mjs
  - .claude/hooks/skill-forced-eval.mjs
  - .claude/hooks/stop-evidence-guard.mjs
  - .claude/plans/task-2724-result-first.md
  - .claude/rules/90-exec-protocol.md
  - .claude/settings.json
  - .claude/skills/wave-drain/SKILL.md
  - .claude/workflows/backlog-wave-ship.mjs
  - .githooks/pre-commit
  - AGENTS.md
  - GLOBAL_INVARIANTS.md
  - __tests__/commands/ship-tier.test.ts
  - __tests__/commands/task-advance-gates.test.ts
  - __tests__/commands/task-handoff-gate.test.ts
  - __tests__/commands/task-handoff-strategy.test.ts
  - __tests__/commands/task-phase-migration.test.ts
  - __tests__/commands/task-ship.test.ts
  - __tests__/commands/task.test.ts
  - __tests__/config/affinity-batching-removed.test.ts
  - __tests__/coverage/task-ship.cov.test.ts
  - __tests__/coverage/task.cov.test.ts
  - __tests__/docs/api-env-vars.test.ts
  - __tests__/e2e/handoff-roundtrip.test.ts
  - __tests__/fixtures/codex-parity/golden/rules/90-exec-protocol.md.golden
  - __tests__/generators/codex.test.ts
  - __tests__/hooks/empirical/skill-forced-eval.test.ts
  - __tests__/hooks/empirical/stop-evidence-guard.test.ts
  - __tests__/hooks/empirical/stop-evidence-journey.test.ts
  - __tests__/hooks/exitplanmode-banner.test.ts
  - __tests__/integration/e2e/functional/packaged-artifact.test.ts
  - __tests__/integration/e2e/bake/__snapshots__/ts-codex-only.json
  - __tests__/integration/gate/codex-self-parity-e2e.test.ts
  - __tests__/generators/derived-class.test.ts
  - __tests__/scripts/check-agent-dispatch.test.ts
  - __tests__/scripts/check-codex-parity.test.ts
  - __tests__/scripts/check-codex-self-parity.test.ts
  - __tests__/scripts/evidence-binding.test.ts
  - __tests__/scripts/route-auditors.test.ts
  - __tests__/templates/commands-governance.test.ts
  - __tests__/templates/commands-tools.test.ts
  - __tests__/tools/claude.test.ts
  - __tests__/tools/codex.test.ts
  - docs/CONCEPTS.md
  - docs/CONTRIBUTING.md
  - docs/GLOSSARY.md
  - docs/QUICKSTART.md
  - docs/REFERENCE/CODEX-PARITY.md
  - docs/REFERENCE/api.md
  - docs/REFERENCE/impact.md
  - docs/REFERENCE/plan-template.md
  - docs/REFERENCE/task-recovery.md
  - docs/REFERENCE/wave-drain.md
  - docs/architecture/arc42.md
  - docs/architecture/c4-model.md
  - docs/internal/ADR/054-phase-3-5-handoff-modeled-as-status-json-fields.md
  - docs/internal/ADR/088-ship-as-orchestration-entrypoint.md
  - docs/internal/ADR/106-codex-track-parity-contract.md
  - docs/internal/architecture/ARCHITECTURE.md
  - docs/internal/METHOD/TESTING.md
  - docs/internal/METHOD/CODEX_PARITY_RUNBOOK.md
  - docs/internal/SYSTEM/CANON.md
  - docs/methodology/agent-orchestration-and-context-hygiene.md
  - examples/go-library.md
  - examples/java-backend-web-db.md
  - examples/python-data-pipeline.md
  - examples/rust-cli.md
  - examples/ts-frontend-spa.md
  - scripts/check-acceptance.mjs
  - scripts/check-agent-dispatch.mjs
  - scripts/check-install-command.mjs
  - scripts/check-no-work-refs.mjs
  - scripts/check-tool-claims.mjs
  - scripts/constraint-map.json
  - scripts/data/codex-parity-baseline.json
  - scripts/data/codex-parity-exclusive.json
  - scripts/data/codex-self-parity-runtime-artifacts.json
  - scripts/route-auditors.mjs
  - src/cli.ts
  - src/commands/ship-tier.ts
  - src/commands/task-ship.ts
  - src/commands/task-state.ts
  - src/commands/task.ts
  - src/config/env-registry.ts
  - src/generators/codex-known-limitations.ts
  - src/generators/codex.ts
  - src/generators/derived-class.ts
  - src/invariants/catalog.ts
  - src/templates/agents-md/AGENTS.md.ejs
  - src/templates/claude/CLAUDE.md.ejs
  - src/templates/claude/commands/drain.md.ejs
  - src/templates/claude/commands/impact.md.ejs
  - src/templates/claude/commands/review.md.ejs
  - src/templates/claude/commands/ship.md.ejs
  - src/templates/claude/hooks/exitplanmode-banner.mjs.ejs
  - src/templates/claude/hooks/skill-forced-eval.mjs.ejs
  - src/templates/claude/hooks/stop-evidence-guard.mjs.ejs
  - src/templates/claude/rules/90-exec-protocol.md.ejs
  - src/templates/claude/settings.json.ejs
  - src/templates/claude/skills/wave-drain/SKILL.md.ejs
  - src/templates/codex/CODEX.md.ejs
  - src/templates/codex/config.toml.ejs
  - src/templates/documentation/cli-catalog.md.ejs
  - src/templates/governance/ci-mental-model.md.ejs
  - src/templates/governance/solo-dev-exception.md.ejs
  - src/templates/githooks/pre-commit.ejs
  - src/templates/root/CONTRIBUTING.md.ejs
  - src/templates/root/TEST_TAXONOMY.md.ejs
  - src/templates/scripts/check-acceptance.mjs.ejs
  - src/templates/scripts/constraint-map.json.ejs
  - src/templates/scripts/check-all.mjs.ejs
  - src/templates/scripts/schemas/cross-model-dispatch.schema.json
  - src/templates/testing/test-taxonomy.md.ejs
  - website/governance/AGENTS.md
  - website/reference/cli.md
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
