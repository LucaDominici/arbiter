---
title: 'Agent-Return Provenance — vendor and model stamped by the recorder'
doc_version: '0.1.0'
status: draft
last_review: '2026-08-26'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/agent', 'kind/design']
related: ['schemas/agent-return.schema.json', 'scripts/record-agent-return.mjs']
---

# Agent-Return Provenance — vendor and model stamped by the recorder

Vendor/model provenance on `arbiter-agent-return-v1` envelopes, stamped by the recorder.

## Problem statement

`schemas/agent-return.schema.json` is `additionalProperties: false` and carries **no field naming which model produced the return**. Today that is harmless because every reviewer, scanner, verifier and M13 skeptic is a Claude subagent: the answer is implicit.

The moment a review slot is handed to an external vendor, the implicit answer becomes false and unrecoverable — an envelope produced by Codex is **indistinguishable** from one produced by Claude. Concrete consequences:

- there is no way to prove after the fact that a panel actually had model diversity;
- `check-refutation-verdicts.mjs` adjudicates an UPHELD majority without being able to tell whether the skeptics were independent _as models_ or merely _as processes_;
- a silent degradation back to Claude would produce evidence that _looks_ cross-model and is not — the worst possible failure mode for a system whose product is evidence.

This is the prerequisite for all cross-model work: without it, the feature is theatre.

## Chosen approach

Add an **optional** `provenance` object to `arbiter-agent-return-v1`, **stamped by the recorder and never trusted from input**.

```jsonc
"provenance": {
  "vendor":     "anthropic" | "openai" | "google" | "other",   // required
  "dispatch":   "subagent" | "external-cli",                    // required
  "cli":        "codex",                                        // optional
  "cliVersion": "0.5.1",                                        // optional
  "model":      "..."                                           // optional
}
```

`scripts/record-agent-return.mjs` gains `--provenance-vendor`, `--provenance-cli`, `--provenance-cli-version`, `--provenance-dispatch` (parsed with the `arg()` helper already used from `scripts/lib/gate-args.mjs`) and **overwrites** any `provenance` present in stdin. With no flags it stamps the default `{ vendor: "anthropic", dispatch: "subagent" }`, so the existing Claude-subagent path gains correct provenance for free, with zero behaviour change.

## Key decisions and rejected alternatives

**D1 — Additive optional field, not `arbiter-agent-return-v2`.**
`additionalProperties: false` blocks _unknown_ keys, not _newly declared optional_ ones. Because `provenance` is not in `required`, every already-persisted envelope stays valid. _Rejected_ the v2: `schema` is a `const`, and `scripts/lib/agent-return-validate.mjs` is shared by `check-agent-return.mjs`, `record-agent-return.mjs`, `check-review-completion.mjs` and `check-refutation-verdicts.mjs`. A v2 would fork five consumers for one field, with zero semantic gain.

**D2 — Stamped by the recorder, never self-declared by the agent. This is the central decision.**
A model asked "which model are you" can lie or hallucinate; a compromised envelope could claim a vendor it is not. Provenance is a fact about the _dispatch_, not an opinion of the agent, and it is known to the caller. The right pattern already exists two lines away: `branch`/`sha`/`ts` are documented in the schema as "stamped by the recorder, never trusted from input" and implemented that way at `record-agent-return.mjs:108-115`. This extends that pattern rather than making an exception to it. _Rejected_ an agent-declared field: it would be unverified evidence dressed as verified evidence.

**D3 — Default `anthropic`/`subagent`, not an absent field.**
An envelope with no provenance would be ambiguous between "produced before the feature existed" and "produced by an unknown vendor". Stamping the default makes every new envelope self-describing from day one and prepares the future ratchet. _Rejected_ leaving the field absent for subagents: it would only defer the problem.

**D4 — No validator change.**
The mini JSON-Schema validator in `scripts/lib/agent-return-validate.mjs` already supports `type`/`required`/`additionalProperties`/`properties`/`enum`/`minLength`, which is everything `provenance` uses. Verified before choosing the field's shape: the shape was chosen _to fit_ the existing validator.

**D5 — The emitted twin moves in the same PR (CANON-01/CANON-14).**
`src/templates/scripts/schemas/agent-return.schema.json.ejs` and `src/templates/scripts/record-agent-return.mjs.ejs` must change alongside the originals: drift is policed by `check-self-dogfood.mjs` (INV-45), so a partial PR breaks the gate.

**D6 — No ratchet in this PR.**
A gate that _requires_ `provenance` on every `role:"reviewer"` envelope is a separate issue, advisory first: no corpus carries the field today, so the ratchet would fail on everything.

## Open questions

- `model` is optional and best-effort: Codex does not guarantee reporting the effective model in its output. Leave it absent when unknown, or introduce an explicit `model: "unknown"`?
- The `vendor` enum is closed over four values. Is `other` a sufficient escape hatch, or should a free string be allowed for self-hosted providers (ollama, lmstudio)?
- Is a backfill of `provenance` over the already-persisted corpus under `.arbiter/evidence/agent-returns/` worth doing, or is "from here on" acceptable?

---

## Acceptance Criteria

- [ ] AC-1: `schemas/agent-return.schema.json` declares `provenance` as an optional object with `vendor` and `dispatch` required, `additionalProperties: false`, and the stated enums; the field does NOT appear in the envelope-level `required`.
- [ ] AC-2: an envelope that is valid today (no `provenance`) still passes `node scripts/check-agent-return.mjs` unchanged — proven by a test over a pre-existing fixture.
- [ ] AC-3: `scripts/record-agent-return.mjs` accepts `--provenance-vendor|--provenance-cli|--provenance-cli-version|--provenance-dispatch` and writes them into the persisted envelope.
- [ ] AC-4: a `provenance` present in the incoming stdin is **overwritten** by the recorder-stamped values — proven by a test that pipes `{"vendor":"openai"}` with no flags and asserts the persisted envelope reads `anthropic`.
- [ ] AC-5: invoked with no provenance flags, the recorder stamps `{ vendor: "anthropic", dispatch: "subagent" }`.
- [ ] AC-6: `src/templates/scripts/schemas/agent-return.schema.json.ejs` and `src/templates/scripts/record-agent-return.mjs.ejs` carry the same changes, and `node scripts/check-self-dogfood.mjs` stays green.
- [ ] AC-7: `node scripts/check-all.mjs L2` green with no changes to `scripts/lib/agent-return-validate.mjs`.

## Non-Goals

- No gate that _requires_ `provenance` (ratchet): that is a follow-up issue, advisory first.
- No provider detection, no external CLI invocation, no `/ship` change: this PR is behaviour-zero.
- No backfill of the existing envelope corpus.
- No bump of `arbiter-agent-return-v1` to v2.

## Files / contracts touched

- `schemas/agent-return.schema.json` — new optional `provenance`
- `scripts/record-agent-return.mjs` — new flags + stamping, extending the pattern at `:108-115`
- `src/templates/scripts/schemas/agent-return.schema.json.ejs` — CANON-01 twin
- `src/templates/scripts/record-agent-return.mjs.ejs` — CANON-01 twin
- `__tests__/scripts/` — tests for AC-2, AC-4, AC-5
- Contract: `arbiter-agent-return-v1` remains the version; no consumer of `scripts/lib/agent-return-validate.mjs` changes

## Wave placement

Lane **A (evidence schema)**, runs first — behaviour-zero and unblocks the cross-model chain. No file-set overlap with any other issue in the wave.
