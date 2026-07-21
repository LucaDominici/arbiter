---
'@arbiter/cli': minor
---

Acceptance-criteria anchor (INV-137, ADR-110): closes the gap between "gate green"
and "what was asked". New feature flag `features.acceptanceAnchor` (opt-in;
`ARBITER_ACCEPTANCE_ANCHOR` env override) activates `scripts/check-acceptance.mjs`
in check-all L1 — implementation-phase plans must freeze the issue's explicit
`AC-N:` acceptance criteria + Non-Goals verbatim, and verification/close requires
the reviewer-written all-PASS `.arbiter/evidence/ac-fit/<task>.json` with a cited
`file:line` per criterion (unproven criterion = REJECT, mechanically). Three
orchestration tools are now emitted to every governed target via `arbiter
init`/`update`: `scripts/issue-readiness.mjs` (entry gate — unready issues get
`needs-clarification` before dispatch), `scripts/rework-log.mjs` (rework telemetry
ledger `.arbiter/rework/ledger.jsonl`, reason × caught-stage taxonomy) and the
shared pure core `scripts/lib/acceptance-criteria.mjs`. The generated ship /
wave-drain / tdd / review skills carry the readiness step, the frozen-anchor
contract, the per-criterion FIT rubric and the Merge Contract derivation. The
task-brief issue templates gain `AC-N:` prefill and a required Non-Goals section.
