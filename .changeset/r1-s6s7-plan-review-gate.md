---
'arbiter': minor
---

feat(w1-bundle): R1.S6+S7 — context-rot 3-layer recovery + N-pass plan reviewer gate (#694 #695)

- `arbiter task recover` prints 3-layer recovery context (BACKLOG.md, CHECKPOINT commits, recent git log)
- `pre-compact` hook injects BACKLOG.md content into preserved-state output
- `dispatchPlanReview` runs `TIER_PASS_COUNT[tier]` invocations per cycle with per-pass evidence under `.arbiter/evidence/plan-review/<sanitized-id>/run-<ts>/`
- `arbiter task advance --to implementation` blocks when `.arbiter/plan-review.enabled` is present and no PASS evidence (with matching plan SHA-256 digest) exists
- `--skip-plan-review` flag + audited env bypass with CI-mode refusal of env-only bypass
