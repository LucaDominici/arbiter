---
title: 'Cross-Model Review Config — the arbiter.json block and diff-egress consent'
doc_version: '0.1.0'
status: draft
last_review: '2026-08-26'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/agent', 'kind/design']
related: ['src/config/schema.ts', 'src/wizard/prompts.ts', 'PRIVACY.md']
---

# Cross-Model Review Config — the arbiter.json block and diff-egress consent

The `crossModelReview` block in `arbiter.json`, and explicit consent to diff egress, from the wizard.

## Implementation status

Implemented in `#2356`: schema validation, configure/env plumbing, conditional wizard consent,
init persistence, the ship-profile reader, and the privacy disclosure are covered. Execution of
external review and diff transmission remain non-goals for this issue.

## Problem statement

For cross-model review to be usable there must be somewhere to declare it: which providers, how many slots, what to do when the provider is missing. And first of all, there must be **consent**.

This is not bureaucracy. `PRIVACY.md:14` states «Arbiter collects zero telemetry and makes zero unsolicited network calls»; `:20` explicitly lists **"Project structure, file names, or code content"** among what never leaves the machine; `:33-40` enumerates **exactly two** network actions (`gh`, recipe fetch). Sending a diff to Codex is egress of _code content_ to a third party. Until that table gains its third row, the published document is **false**.

For a project that sells privacy as a mechanical gate rather than a promise, this is the sharpest constraint in the whole feature.

## Chosen approach

A top-level **additive, optional** block in `arbiter.json`, validated only when present, with **no `$schemaVersion` bump** (it stays 4):

```jsonc
"crossModelReview": {
  "enabled": false,
  "diffEgressConsent": false,
  "providers": ["codex"],
  "slots": { "codeReview": 1, "redTeamReview": 0 },
  "timeoutMs": 300000,
  "onUnavailable": "degrade"
}
```

Validator `validateCrossModelReview()` in `src/config/schema.ts`, modelled on `validateContextPack` (`:1179`) and called from the same site (`:976`).

**Wizard question**, gated exactly like Q12 (`collectDecompositionBackend`, `prompts.ts:417-443`): asked **only if** at least one provider is `available && authenticated`. If the CLI is present but unauthenticated, print a one-line note and do not ask. If it is absent, the question never appears.

> Cross-model review? One code-review slot is handed to your local `codex` CLI (OpenAI) instead of a Claude subagent, so the review panel has genuine model diversity.
> This sends the change diff to a third-party vendor, under **your** credentials. arbiter makes no network calls itself and never sees a token.
> Default: **no**.

A single `confirm` sets **both** `enabled` **and** `diffEgressConsent`. A negative answer (or a skipped question) ⇒ the block is **omitted entirely** from `arbiter.json`: absence means off, and no dormant field is left behind.

## Key decisions and rejected alternatives

**D1 — `PRIVACY.md` gains its third row in this PR. It is an acceptance criterion, not a doc chore.**
The "What Arbiter Does Over the Network" table must list the egress to the provider CLI, using the same formula already used for `gh` ("uses its own auth — arbiter never receives or transmits a token itself"), and the "code content" bullet must be qualified. _Rejected_ deferring it to a docs PR: the claim becomes false the moment the feature ships, and a project that mechanically polices the truth of its own claims cannot afford that.

**D2 — Additive block, `$schemaVersion` stays 4.**
The precedent is explicit in the code: `validateAutomationPrefs`'s own comment (`schema.ts:1163-1166`) reads "additive (no `$schemaVersion` bump): validated only when present, so a legacy config stays valid". An existing config with no `crossModelReview` stays valid and behaves exactly as today. _Rejected_ the bump: it would force a `v4→v5` migration for a purely optional block.

**D3 — No `features.crossModelReview` boolean.**
The block already carries `enabled`. Two switches would be two sources of truth and would produce precisely the #2344 ambiguity. Consequence to accept knowingly: the `ARBITER_FEATURE__*` prefix dispatcher will not reach the block, which is why a bespoke `ARBITER_CROSS_MODEL_REVIEW` flag is needed in `src/config/env-registry.ts` — same rationale as `ARBITER_ACCEPTANCE_ANCHOR`. It must be marked **`isGateBypass: true`**: switching off an adversarial-review axis _is_ a gate weakening and belongs in the bypass census.

**D4 — `diffEgressConsent` separate from `enabled`, even though the wizard sets them together.**
They are two different facts: "I want cross-model review" and "I consent to sending my code to a third party". Keeping them distinct in the schema lets the planner degrade with the specific reason `consent-absent` when the CLI is present and authenticated but consent is missing — which is the case that must **absolutely** be degraded rather than silently assumed. _Rejected_ a single key: it would lose that distinction exactly where it matters. _Rejected_ two separate wizard questions: that would be consent theatre.

**D5 — Only `crossModelReview.enabled` goes in `OVERRIDABLE_PATHS`.**
A single run may legitimately _switch off_ the external slot (offline, rate-limited, cost). It must not be able to **switch consent on**, change provider, or flip `onUnavailable` from the command line: consent is persistent project identity, like `governanceLevel`, which is already non-overridable. The existing test asserting `OVERRIDABLE_PATHS ⊆ ALLOWED_PATHS` and the `assertOverridablePath` hint string need checking.

**D6 — Default `false`, and no question when it is not useful.**
An egress question cannot default to yes. And a user is not asked to configure something their machine does not have: the gating replicates Q12, which is already the precedent for "question conditional on a CLI being present".

**D7 — The block must have a real reader in this same PR.**
`resolveShipProfile` (`src/commands/ship-profile.ts`) exposes it on `ShipProfile` and `arbiter doctor` prints it. Without that, this PR **is** bug #2344/#2333. If for some reason the reader cannot land here, this issue must be merged with #2357.

## Open questions

- `slots.codeReview` is limited to `0|1` and `slots.redTeamReview` is limited to `0` until a red-team consumer ships; unsupported slot requests fail validation instead of being silently ignored.
- `timeoutMs` at 300 s is a guess. It should be calibrated against a real measurement of `codex exec` on an average diff.
- The wizard is already 18 questions. Is one more conditional question acceptable, or should cross-model configuration move entirely to post-init `arbiter configure`?

---

## Acceptance Criteria

- [ ] AC-1: `PRIVACY.md` gains a third row in the "What Arbiter Does Over the Network" table describing diff egress to the provider CLI, and the "code content" bullet at `:20` is qualified consistently.
- [ ] AC-2: `ArbiterConfigV2` carries `crossModelReview?` and `validateCrossModelReview()` validates the fields **only when the block is present**; `CURRENT_CONFIG_SCHEMA_VERSION` stays `4`.
- [ ] AC-3: an existing `arbiter.json` without the block stays valid and behaves as today — proven by a test over a legacy fixture.
- [ ] AC-4: `ALLOWED_PATHS` includes every field of the block; `OVERRIDABLE_PATHS` includes **only** `crossModelReview.enabled`, and `arbiter ship --set crossModelReview.diffEgressConsent=true` is **rejected**.
- [ ] AC-5: `ARBITER_CROSS_MODEL_REVIEW` is registered in `src/config/env-registry.ts` with `isGateBypass: true`; `__tests__/config/env-flag-inventory.test.ts` stays green.
- [ ] AC-6: the wizard question is **skipped** when no provider is `available`; prints a note and does not ask when available but not authenticated; asks only when authenticated.
- [ ] AC-7: the question defaults to `false`, and a negative answer **omits the block entirely** from `arbiter.json`.
- [ ] AC-8: the block has a real reader in this PR — `resolveShipProfile` exposes it on `ShipProfile` and a test proves the read (anti-#2344).
- [ ] AC-9: `node scripts/check-all.mjs L2` green.

## Non-Goals

- No external CLI invocation, no diff actually sent: this PR configures and asks for consent, it does not execute.
- No slot allocation in `/ship`, no degradation artifact, no new gate.
- No `$schemaVersion` bump, no migration.
- No additional `features.*` boolean.

## Files / contracts touched

- `PRIVACY.md` — third network row (D1, blocking)
- `src/config/schema.ts` — `CrossModelReviewConfig`, `validateCrossModelReview()`, field on `ArbiterConfigV2`
- `src/config/env-registry.ts` — `ARBITER_CROSS_MODEL_REVIEW` (`isGateBypass: true`)
- `src/commands/configure.ts` — `ALLOWED_PATHS`, `OVERRIDABLE_PATHS`, array-valued parsing of `providers` (the `tools` precedent)
- `src/wizard/prompts.ts` — conditional question + `buildConfigFromAnswers`
- `src/wizard/types.ts` — `WizardInput` carries detected provider state
- `src/commands/init/build-arbiter-config.ts` — emitting (or omitting) the block
- `src/commands/ship-profile.ts` — the real reader (AC-8)
- `__tests__/config/`, `__tests__/commands/`, `__tests__/wizard/`
- Contract: `arbiter.json` `$schemaVersion` stays 4; no existing config becomes invalid

## Wave placement

Lane **C (config & wizard)**. Depends on #2355. Touches `src/commands/ship-profile.ts`, which #2357 also touches — `conflicts-with:#2357`, so the two share a serial lane.
