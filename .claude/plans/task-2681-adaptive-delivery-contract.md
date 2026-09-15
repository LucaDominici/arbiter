---
files:
  - .arbiter/evidence/ac-fit/2681.json
  - .arbiter/evidence/rtm/REQ-053.json
  - .arbiter/evidence/tdd/#2681.json
  - .claude/agent-dispatch-matrix.json
  - .claude/commands/review-code.md
  - .claude/commands/ship.md
  - .claude/plans/task-2681-adaptive-delivery-contract.md
  - __tests__/behavioral/help-surface.test.ts
  - __tests__/commands/cross-model-review.test.ts
  - __tests__/commands/ship-review.test.ts
  - __tests__/commands/ship-tier.test.ts
  - __tests__/commands/ship-train.test.ts
  - __tests__/commands/task-advance-gates.test.ts
  - __tests__/commands/task-ship.test.ts
  - __tests__/commands/task-state.test.ts
  - __tests__/commands/task.test.ts
  - __tests__/config/affinity-batching-removed.test.ts
  - __tests__/coverage/task-ship.cov.test.ts
  - __tests__/docs/review-code-ssot.test.ts
  - __tests__/governance/ship-train-playbook.test.ts
  - __tests__/integration/e2e/bake/__snapshots__/go-backend-web-gcr.json
  - __tests__/integration/e2e/bake/__snapshots__/go-bdd.json
  - __tests__/integration/e2e/bake/__snapshots__/go-library.json
  - __tests__/integration/e2e/bake/__snapshots__/java-backend-web-db-acr.json
  - __tests__/integration/e2e/bake/__snapshots__/java-backend-web-db-gradle.json
  - __tests__/integration/e2e/bake/__snapshots__/java-bdd-gradle.json
  - __tests__/integration/e2e/bake/__snapshots__/java-library-gradle.json
  - __tests__/integration/e2e/bake/__snapshots__/java-spring-L3.json
  - __tests__/integration/e2e/bake/__snapshots__/java-spring-L4.json
  - __tests__/integration/e2e/bake/__snapshots__/multi-lane-fe-be.json
  - __tests__/integration/e2e/bake/__snapshots__/python-backend-web-ecs.json
  - __tests__/integration/e2e/bake/__snapshots__/python-backend-web.json
  - __tests__/integration/e2e/bake/__snapshots__/python-bdd.json
  - __tests__/integration/e2e/bake/__snapshots__/python-data-pipeline.json
  - __tests__/integration/e2e/bake/__snapshots__/python-library.json
  - __tests__/integration/e2e/bake/__snapshots__/rust-bdd.json
  - __tests__/integration/e2e/bake/__snapshots__/rust-cli.json
  - __tests__/integration/e2e/bake/__snapshots__/rust-embedded.json
  - __tests__/integration/e2e/bake/__snapshots__/rust-library.json
  - __tests__/integration/e2e/bake/__snapshots__/ts-backend-web-db-ghcr.json
  - __tests__/integration/e2e/bake/__snapshots__/ts-backend-web-db-none.json
  - __tests__/integration/e2e/bake/__snapshots__/ts-backend-web-db.json
  - __tests__/integration/e2e/bake/__snapshots__/ts-bdd.json
  - __tests__/integration/e2e/bake/__snapshots__/ts-codex-only.json
  - __tests__/integration/e2e/bake/__snapshots__/ts-frontend-spa.json
  - __tests__/integration/e2e/bake/__snapshots__/ts-library.json
  - __tests__/integration/e2e/bake/__snapshots__/vue-frontend-spa.json
  - __tests__/matrix/cross-product.test.ts
  - __tests__/scripts/check-agent-dispatch.test.ts
  - __tests__/scripts/check-review-completion.test.ts
  - __tests__/scripts/record-agent-return-modes.test.ts
  - __tests__/scripts/route-auditors.test.ts
  - __tests__/templates/commands-claude.test.ts
  - __tests__/templates/commands-governance.test.ts
  - __tests__/templates/ship-driver-render.test.ts
  - __tests__/templates/task-tiers-template.test.ts
  - examples/go-library/.arbiter-generated-manifest.json
  - examples/go-library/.claude/commands/ship.md
  - examples/go-library/scripts/check-review-completion.mjs
  - examples/go-library/scripts/record-agent-return.mjs
  - examples/python-library/.arbiter-generated-manifest.json
  - examples/python-library/.claude/commands/ship.md
  - examples/python-library/scripts/check-review-completion.mjs
  - examples/python-library/scripts/record-agent-return.mjs
  - examples/ts-library/.arbiter-generated-manifest.json
  - examples/ts-library/.claude/commands/ship.md
  - examples/ts-library/scripts/check-review-completion.mjs
  - examples/ts-library/scripts/record-agent-return.mjs
  - scripts/check-agent-dispatch.mjs
  - scripts/debt-baseline.json
  - scripts/check-review-completion.mjs
  - scripts/record-agent-return.mjs
  - src/cli.ts
  - src/commands/ship-review.ts
  - src/commands/ship-tier.ts
  - src/commands/ship-train.ts
  - src/commands/task-ship.ts
  - src/commands/task-state.ts
  - src/commands/task.ts
  - src/generators/check-all.ts
  - src/i18n/en.json
  - src/templates/claude/commands/ship.md.ejs
  - src/templates/scripts/check-review-completion.mjs.ejs
  - src/templates/scripts/record-agent-return.mjs.ejs
  - website/reference/cli.md
---

# Plan — #2681 One adaptive delivery obligation contract

## Context Block

- base_branch: `origin/main`
- baseline: `0d57b6277810423560115c3407718b3f82542777`
- key_constraints: one writer; `/ship` remains the only delivery entry; no second orchestrator/store/router; unknown input cannot narrow; maximum two normal review rounds; one final full gate.
- red_team_warnings: keep final gate exact-HEAD; keep review evidence content-bound; capability hints must not select a provider model; a round cap must end BLOCKED while applicable MED/HIGH/CRITICAL findings remain.
- estimate: one candidate, one independent final review, one AC-fit pass.
- files:
  - src/commands/ship-tier.ts
  - src/commands/ship-review.ts
  - src/commands/ship-train.ts
  - src/commands/task-state.ts
  - src/commands/task.ts
  - src/commands/task-ship.ts
  - src/cli.ts
  - scripts/record-agent-return.mjs
  - scripts/check-review-completion.mjs
  - scripts/debt-baseline.json
  - .claude/commands/ship.md
  - src/templates/claude/commands/ship.md.ejs
  - website/reference/cli.md
  - docs/internal/ADR/088-ship-as-orchestration-entrypoint.md
  - docs/internal/ADR/111-tier-origination-human-only.md
  - docs/internal/ADR/119-adversarial-review-hops-until-low-only.md
  - docs/internal/SYSTEM/CANON.md
  - __tests__/commands/ship-tier.test.ts
  - __tests__/commands/ship-review.test.ts
  - __tests__/commands/ship-train.test.ts
  - __tests__/commands/task-ship.test.ts
  - __tests__/commands/task-state.test.ts

## Approach & decomposition

1. Extend the existing ship-tier policy into the sole `ShipTreatment` resolver. It returns the effective tier, sensitive overlay, named reviewer verticals, plan depth, reviewer counts, model capability hint and reasons. XS/S require complete affirmative signals; missing, malformed or stale input resolves to Standard. Persist the effective treatment so widening survives resume.
2. Keep `ship-review.ts` and `ship-train.ts` as small pure policies owned by the treatment. Review stops after two normal rounds and reports BLOCKED while applicable findings above LOW remain. Train admission evaluates hard exclusions before positive affinity and returns explained `JOIN`/`SEAL`.
3. Make lifecycle transitions consume the persisted treatment so direct low-level advance cannot bypass round/review obligations. Keep existing acceptance, review-completion, gate-pass, done-evidence and PR-merge checks.
4. Make `/ship` render/query the same treatment and remove duplicate count/severity/affinity rules from the command document. Current public command names stay until C2-D.
5. Make existing reviewer recorder/completion checks consume the persisted treatment instead of independently choosing panel size. Do not add another evidence file.

## Threat model & abuse cases

Untrusted issue metadata, stale dependency graphs, incomplete plan manifests, fabricated reviewer panels, direct lifecycle calls and source changes after review must not reduce obligations or claim completion. Treat unavailable infrastructure as an explicit non-product result; it cannot raise model capability or become PASS.

## Input validation

Validate every persisted treatment field and binding before use. Repo paths must be relative, normalized and complete for a narrow treatment. Unknown labels, graph records, timestamps, reviewer returns or affinity components fail toward Standard/SEAL/BLOCKED. Refused transitions do not mutate state.

## Idiomatic patterns & pitfalls

Reuse `ship-tier.ts`, `evaluateReviewRound`, `evaluateSeal`, unified task state, auditor routing, content-bound review evidence and exact-HEAD gate receipts. Avoid a new registry, DSL, model selector or evidence store. Preserve the installed-consumer path and EJS self parity.

## Acceptance Criteria

- [ ] AC-1: absent or malformed reviewer evidence, an applicable MED/HIGH/CRITICAL finding, a spent round cap, mutated source, missing final receipt, pending/failed CI and an unmerged PR each refuse completion without partial state mutation.
- [ ] AC-2: XS/S are emitted only from complete fresh affirmative signals; any unknown input resolves to Standard and an effective widening cannot later narrow during the same task.
- [ ] AC-3: XS/S require one pertinent final reviewer plus independent AC-fit; Standard requires two orthogonal reviewer verticals plus AC-fit; a sensitive overlay adds only the pertinent specialist and never exceeds three code reviewers.
- [ ] AC-4: model capability starts at economy/capable/frontier as the treatment requires and escalates only for named lack of progress or new risk, never for timeout, OOM, rate limit, unavailable tool or CI queue.
- [ ] AC-5: train admission exposes its components and a `JOIN` or `SEAL(reason)` verdict; unknown evidence and every authority/schema/migration/generated-master/acceptance/rollback conflict seal; the negative corpus has zero false JOIN.
- [ ] AC-6: all findings in one round reconcile into one fix batch; a new source SHA invalidates dependent review evidence; an unchanged final qualification is reused through landing.
- [ ] AC-7: `ship` and direct lifecycle transitions use the same persisted treatment and resume reconstructs the same next action without transcript history.
- [ ] AC-8: the current public vocabulary remains unchanged in this candidate; C2-D owns the incompatible rename after destination handlers exist.

## Test strategy

- AC-2/3/4: table-driven ship-tier treatment tests plus ship-step rendering tests.
- AC-5: table-driven train exclusion and positive-join tests; seed and append paths must agree.
- AC-1/6/7: lifecycle/review tests covering refused mutation, round accounting and restart.
- Existing review-completion, acceptance, gate-binding, merged-PR and rendered-template suites prove preserved lower-level guarantees.
- Final verification: targeted suites during edits, then one clean-HEAD `node scripts/check-all.mjs L3`, PR CI and exact merged SHA.

## Risks

- Fail-closed qualification may make narrow treatments rare until callers provide complete data. This is accepted; low recall costs time, while a false narrow can lose a guarantee.
- Existing prompt and recorder contain duplicated policy. Delete only the rules now represented by treatment output; retain instructions that tell the host how to perform assigned work.
- Do not bind review evidence to exact HEAD; evidence-only commits must remain valid. The final gate receipt stays exact-HEAD.

## Non-goals

- Public lifecycle command rename/removal; native checkout ownership; configuration wizard; product audit; new model provider integration; learned affinity weights; automatic quota/provider selection.
