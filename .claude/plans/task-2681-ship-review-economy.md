# Plan — #2681 Remove redundant pre-code review fan-out in trunk-solo

## Preamble

- Baseline: `0027d33f05c4648e380f8a5db3a020a269e86fa5`.
- Measured defect: `/ship` already limits final code review to one reviewer in `trunk-solo`, but still forces 1/2/3 pre-implementation red-team agents by tier and blocks `red` without their evidence.
- Result observed on #2550: a complete owner-approved plan cannot enter TDD without three more model calls, despite no routed auth, data, concurrency, money, migration or deployment risk.
- This PR delivers one bounded part of #2681 and leaves its heavy-run/KPI/secondary-task items open.

## Deliverable

For `collaborationMode=trunk-solo`, `/ship` performs no pre-implementation reviewer dispatch. The root implementer remains responsible for a complete plan and threat model; the existing independent final code review and file-path risk escalation remain unchanged. `peer-review` and `gated-review` retain tier-N pre-code red-team behavior.

Implementation:

1. Reuse the existing collaboration mode already present in `ShipProfile` and task config. No flag or new configuration axis.
2. Return `reviewAgents: 0` and an explicit final-review instruction for the trunk-solo `red-team-review` step; preserve `REDTEAM_AGENTS[tier]` for other modes.
3. Let the lifecycle leave `red-team-review` without a red-team evidence file only when current repo config is explicitly `trunk-solo`. Missing/malformed config and all other modes keep failing closed.
4. Update the canonical `/ship` document and template to describe this mode-specific contract.
5. Prove pure routing and the state transition. Existing peer/gated evidence-gate tests remain green.

## Acceptance criteria

- [ ] AC-1: trunk-solo Standard reports zero pre-code red-team agents and can advance to `red` without a fabricated evidence file.
- [ ] AC-2: peer-review and gated-review still report tier-N agents and refuse to leave red-team review without evidence.
- [ ] AC-3: plan-review admission, acceptance-anchor admission, handoff logic, one independent final code reviewer and high-risk final escalation are unchanged.
- [ ] AC-4: self and emitted `/ship` docs state the same mode-specific behavior.
- [ ] AC-5: mechanisms decrease for trunk-solo (pre-code panel and evidence requirement removed); guarantees are preserved by plan completeness, TDD, final review, AC-fit, L3 and CI.

## Verification

- RED: focused routing/state tests fail under current behavior.
- GREEN: focused command tests and docs parity pass.
- One frozen-SHA native independent review, deterministic AC-fit, one final clean-HEAD L3, PR CI, exact-SHA merge.
- After merge, rebuild/reinitialize the paused #2550 worktree and immediately prove it enters `red` with no red-team evidence.

## Bootstrap note

The defect controls the phase needed to repair itself. For this issue only, the root records an explicit degraded self-review artifact naming this bootstrap and its risks; no agent identities or independent verdicts are fabricated. The new behavior must pass its own transition test before implementation is considered green.

## Non-goals

- No removal of the lifecycle phase or evidence schema.
- No new risk classifier, orchestrator, evidence store, flag or model-selection system.
- No change to peer/gated collaboration modes, final review routing, review-round cap, gates or merge policy.
- No closure of #2681 until its remaining measured root causes are reconciled.
