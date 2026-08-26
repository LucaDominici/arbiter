---
title: 'Cross-Model Degradation Evidence — dispatch artifact, gate and model_diversity axis'
doc_version: '0.1.0'
status: draft
last_review: '2026-08-26'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/agent', 'kind/design']
related: ['scripts/check-agent-dispatch.mjs', '.claude/agent-dispatch-matrix.json']
---

# Cross-Model Degradation Evidence — dispatch artifact, gate and model_diversity axis

Provider degradation artifact, advisory accountability gate, and the `model_diversity` axis.

## Problem statement

The real risk of cross-model review is not that the external provider is missing. It is that it goes missing **silently**.

A quiet fallback to Claude produces a panel that _looks_ model-diverse and is not: evidence that claims more than what happened. For a system whose product is evidence, that is the worst possible failure mode — and it is exactly the class INV-96 (`check-fail-closed-audit.mjs`) forbids and that `arbiter doctor fail-open-census` exists to census.

There is a specific blind spot to declare openly: the provider presence check lives in `src/`, while the fail-open census scans only `scripts/`. **The census will not see this fail-open.** The compensating control is precisely the artifact described here; not naming the blind spot would be leaving it in silence, which is the very defect being corrected.

There is also a parity loop to close: how many external slots each tier gets must be declared in an oracle separate from the code that derives it, as already happens for `tier_verticals` and `refutation_skeptics`.

## Chosen approach

**Artifact** — `.arbiter/evidence/cross-model/<task>/dispatch.json`, written on **every** run with `enabled: true`, including the fully degraded case:

```jsonc
{
  "schema": "arbiter-cross-model-dispatch-v1",
  "taskId": "#2400",
  "branch": "…",
  "sha": "…",
  "ts": "…",
  "phase": "refactor",
  "requested": [{ "provider": "codex", "vertical": "security" }],
  "fulfilled": [
    {
      "provider": "codex",
      "cliVersion": "0.5.1",
      "envelope": ".arbiter/evidence/agent-returns/2400/codex-reviewer-1.json",
    },
  ],
  "degraded": [
    {
      "provider": "codex",
      "vertical": "security",
      "substitute": "anthropic",
      "reason": "cli-not-found",
      "detail": "Command not found: codex",
    },
  ],
}
```

`reason` is a **closed enum**: `cli-not-found | not-authenticated | consent-absent | disabled-by-env | timeout | nonzero-exit | coercion-failed | envelope-rejected | diff-truncated`.

**Gate** — `scripts/check-cross-model-review.mjs`, wired into `check-all.mjs` as `runWarnCheck`.

**Dispatch axis** — `.claude/agent-dispatch-matrix.json` gains a top-level `model_diversity: { XS: 0, S: 0, Standard: 1 }`, with parity asserted against the code.

## Key decisions and rejected alternatives

**D1 — "I asked for X, I got Y, because Z" with Z mandatory and from a closed enum.**
An empty or out-of-enum `reason` is a gate FAIL. A free string would degenerate into "unavailable" and would not distinguish the operational case (CLI absent) from the one that needs looking at (envelope rejected, coercion failed). The enum _is_ the artifact: without it the file is noise.

**D2 — Written even when everything degraded.**
That is the case that matters most. Writing it only on partial success would reintroduce the silence this issue removes. When the config block is absent or `enabled: false`, nothing is written: absence of configuration is itself the record, and there is nothing to account for.

**D3 — Advisory first, blocking later.**
`runWarnCheck` follows the E1–E6 family precedent (`check-all.mjs:445-451`), wired advisory so the path is real before it bites. Promotion to `runCheck` is a separate issue, once a corpus of dispatch records exists. _Rejected_ blocking immediately: it would fail the gate on every tree that does not yet have the feature.

**D4 — An "external" slot returning `anthropic` provenance is a lie, and the gate says so.**
Every `fulfilled[].envelope` must exist **and** carry `provenance.vendor !== "anthropic"`. This is the check that makes the feature auditable rather than declarative, and the reason the provenance issue (#2354) is a prerequisite.

**D5 — New script, with a CATALOG justifying three rejected fold-ins (CANON-21).**
`check-agent-return.mjs` is a _corpus_ validator: a requested-but-never-launched provider produces no envelope and is therefore **structurally invisible** to a corpus walk. `check-review-completion.mjs` (#2177) reconciles _how many_ reviewers returned, not _which vendor_ degraded and why; its sidecar has no provider field. `check-agent-dispatch.mjs` replays a static oracle against compiled logic with no runtime evidence input. Inputs, lifecycle and verdict differ in all three cases.

**D6 — `model_diversity` as a new top-level block, without touching `tier_verticals`.**
`check-agent-dispatch.mjs` validates the presence of four required keys and asserts `tier_verticals[tier] === verticalsForTier(tier)`. Adding a top-level key is exactly how `refutation_skeptics` was added: safe. `tier_verticals` is the parity-locked field and must not be touched. The gate gains a **third assertion** (`model_diversity[tier] === externalSlotsForTier(tier)` and `0 <= model_diversity[tier] <= REVIEW_AGENTS[tier]`): an extension of the existing script, so **no new CATALOG** for that part.

**D7 — XS stays 0.**
XS has exactly 1 reviewer: an external slot would make the panel 100% external and lose the Anthropic baseline entirely. The `<= REVIEW_AGENTS[tier]` bound makes that mechanical rather than conventional.

**D8 — `onUnavailable: "fail"` stops the ship.**
For anyone who wants cross-model as a requirement rather than an optional extra, degradation must read as red. The default stays `degrade`.

**D9 — Reuse the existing generic validator.**
The new `schemas/cross-model-dispatch.schema.json` is validated with `validateSchema` from `scripts/lib/agent-return-validate.mjs`, already shared with `check-evidence-bundle.mjs`. No third validator is written.

**D10 — Explicit skip, never faked (INV-115).**
With the feature off the gate exits 0 printing `skipped: crossModelReview not enabled`. The scope condition is itself checked, not skipped.

## Open questions

- Does the advisory→blocking promotion need a declared threshold (N runs with a dispatch record), or is maintainer judgement enough?
- Does a high `envelope-rejected` rate mean the prompt is weak or that M12 is too strict for an external model? Is local telemetry (nothing sent) needed to notice?
- Should the artifact be committed like `ac-fit` and `tdd` (which have explicit `.gitignore` negations) so the PR carries the record, or stay local?

---

## Acceptance Criteria

- [ ] AC-1: `.arbiter/evidence/cross-model/<task>/dispatch.json` is written on every run with `enabled: true`, **including** the fully degraded case.
- [ ] AC-2: `reason` is a closed enum of nine values; an empty or out-of-enum value makes the gate exit 1.
- [ ] AC-3: `schemas/cross-model-dispatch.schema.json` exists and is validated by reusing `validateSchema` from `scripts/lib/agent-return-validate.mjs` (no third validator).
- [ ] AC-4: `scripts/check-cross-model-review.mjs` carries a `// CATALOG:` block justifying the three rejected fold-ins (CANON-21), and honours the 0/1/2 exit-code contract (INV-53).
- [ ] AC-5: with `enabled: false` the gate exits 0 printing an **explicit skip**, never a faked pass (INV-115).
- [ ] AC-6: a `fulfilled[].envelope` whose `provenance.vendor` is `anthropic` makes the gate exit 1.
- [ ] AC-7: `enabled: true` with a missing `dispatch.json` makes the gate exit 1; `onUnavailable: "fail"` with a non-empty `degraded[]` exits 1.
- [ ] AC-8: the gate is wired into `check-all.mjs` as `runWarnCheck` and the advisory count in the header comment is updated.
- [ ] AC-9: `.claude/agent-dispatch-matrix.json` carries `model_diversity` with a `_doc`; `tier_verticals` is **not** modified.
- [ ] AC-10: `check-agent-dispatch.mjs` asserts `model_diversity[tier] === externalSlotsForTier(tier)` and `0 <= model_diversity[tier] <= REVIEW_AGENTS[tier]`; a planted mismatch fails.
- [ ] AC-11: the `fail-open-census` blind spot (check in `src/`, census over `scripts/`) is documented in the script's header comment, naming the compensating control.
- [ ] AC-12: `node scripts/check-all.mjs L2` green.

## Non-Goals

- No promotion of the gate from advisory to blocking: separate issue, after a corpus exists.
- No ratchet requiring `provenance` on every reviewer envelope.
- No change to `tier_verticals`, panel counts, or tier selection.
- No telemetry of any kind: the artifact stays local to the repo.

## Files / contracts touched

- `scripts/check-cross-model-review.mjs` — new, with CATALOG (CANON-21)
- `schemas/cross-model-dispatch.schema.json` — new
- `scripts/check-all.mjs` — `runWarnCheck` wiring + advisory count
- `scripts/check-agent-dispatch.mjs` — third assertion (extension, not a new script)
- `.claude/agent-dispatch-matrix.json` — `model_diversity` block
- `src/integrations/external-review.ts` — artifact writing + `externalSlotsForTier`
- `src/templates/scripts/check-cross-model-review.mjs.ejs` + wiring in `check-all.mjs.ejs` — CANON-01 twin
- `src/generators/check-all.ts` — emission registration
- `__tests__/scripts/check-cross-model-review.test.ts`, `__tests__/scripts/check-agent-dispatch-*.test.ts`
- Contract: `arbiter-cross-model-dispatch-v1` new; `agent-dispatch-matrix` backward-compatible (addition only)

## Wave placement

Lane **D (ship slot)**, after #2357. `conflicts-with:#2357` — both touch `src/integrations/external-review.ts`; serial lane, same worktree.
