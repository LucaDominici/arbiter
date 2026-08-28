---
title: 'Cross-Model Review Slot — an external-vendor reviewer in /ship'
doc_version: '0.1.0'
status: draft
last_review: '2026-08-26'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/agent', 'kind/design']
related: ['src/commands/task-ship.ts', '.claude/commands/ship.md']
---

# Cross-Model Review Slot — an external-vendor reviewer in /ship

An external-vendor review slot in `/ship` — the panel never shrinks.

## Problem statement

arbiter already has a serious adversarial protocol: refutation-by-majority (M13), where N independent skeptics are given an explicit mandate to **refute** a finding, and the finding survives only on a strict UPHELD majority. But **every skeptic is a Claude subagent**. The independence is _procedural_, not _of model_: N reviewers of the same model share the same training bias and the same blind spots, and a skeptic that shares the proposer's training is the worst possible case for a refutation test.

Internal study #2176 confirms it from the opposite direction: 1 reviewer catches 77% ITT / 88% per-protocol, 2 catch 87.5%, 3 catch 90.1%. **Widening a same-model panel has diminishing returns**, and `.claude/commands/ship.md:84-93` observes that false positives grow with panel size. The unused lever is not the number of heads: it is **model diversity**.

## Chosen approach

One of the code-review slots is handed to an external vendor's CLI instead of a Claude subagent.

The piece of luck that makes this nearly free: `codex exec` supports `--output-schema <path>`, i.e. it **returns JSON conforming to a schema we supply**. arbiter already owns that schema. The external reviewer natively returns an `arbiter-agent-return-v1` envelope and re-enters the `record-agent-return.mjs → check-agent-return.mjs` pipeline **without touching it**. No prose parsing, no brittle coercion.

```
codex exec --strict-config --ephemeral --ignore-user-config \
  -c 'default_permissions="arbiter-cross-model-review"' \
  -c 'permissions.arbiter-cross-model-review.extends=":read-only"' \
  -c 'permissions.arbiter-cross-model-review.filesystem.:root="deny"' \
  -c 'permissions.arbiter-cross-model-review.filesystem.:minimal="read"' \
  -c 'permissions.arbiter-cross-model-review.network.enabled=false' \
  --skip-git-repo-check --output-schema <tmp>/agent-return-external.schema.json \
  -o <tmp>/return.json -C <tmp> -
```

Prompt and diff are on **stdin** (`RunCliOptions.input`), never in argv. The scratch-only profile
extends Codex `:read-only`, denies the host filesystem root, permits reads only from the scratch
directory, and disables network access. The legacy `--sandbox read-only` flag is not combined with
`default_permissions`: Codex rejects those two overrides together, while the explicit profile
preserves the read-only classification in `.claude/agents/agent-write-classes.json` and the
read-only clause of rule `50-batch-execution`.

The testable core is a **pure planner**, separated from the invoker that crosses the subprocess boundary:

```ts
planCrossModelSlots({ tier, phase, totalSlots, verticals, cfg, access }): CrossModelPlan
```

## Key decisions and rejected alternatives

**D1 — The panel never shrinks. This is the central invariant.**
The external slot **replaces** an Anthropic slot: `external + anthropic === total`, always. If the provider cannot run, that seat **reverts** to Anthropic. This preserves the panel sizes validated by #2176 and keeps `check-review-completion.mjs`'s (#2177) count reconciliation valid. _Rejected_ adding the external slot _on top of_ the panel: it would raise cost and false positives to buy what diversity already delivers, contradicting the study.

**D2 — A reduced external schema, not the full one.**
The full schema uses `format: date-time`, `pattern`, `minLength`, `minimum/maximum`, which strict structured-output mode does not support. And in any case `branch`/`sha`/`ts` are **stamped by the recorder and never trusted from input** (`record-agent-return.mjs:108-115`). Hence `schemas/agent-return-external.schema.json`: only `verdict`, `confidence`, `findings[]`, `refutations[]` — exactly the part the agent must supply. This is not an exception to the existing design: it is an application of it.

**D3 — `retries: 0`, never more.**
Every retry re-egresses the diff to a third party and spends the user's money. A review is not idempotent and must not be repeated blindly. _Rejected_ `runCli`'s retry default.

**D4 — Diff on stdin, capped at 512 KB, truncation = recorded degradation.**
argv has limits (ARG_MAX) and quoting hazards. The cap avoids shipping enormous diffs; but truncation is **never silent**: it emits a marker in the prompt and a dedicated degradation reason.

**D5 — v1 on the code-review slot; the stated destination is M13 refutation.**
Code review is where the machinery already exists (counts in `task-ship.ts`, #2177 reconciliation, `agents-dispatched.json` evidence): it is the implementable path with the least new surface. But the highest value is on the M13 skeptics, where **independence _is_ the mechanism**: replacing one of the 3 Standard skeptics with a different vendor raises real independence at unchanged cost and panel size. Stating it here as an explicit follow-on rather than leaving it implicit means v1 is designed to enable it (`slots.redTeamReview` already exists in the schema).

**D6 — `task-ship.ts` stays pure; detection is injected.**
`ShipStep` gains an **additive optional** `externalReviewers?`; `reviewAgents` keeps its meaning (the **total**) and its values unchanged, so every existing consumer and fixture stays byte-identical. Detection happens at the CLI edge and is passed in: the sequencer stays pure and its unit tests stay hermetic. _Rejected_ invoking the detector inside `task-ship.ts`: it would poison every existing test with a subprocess boundary.

**D7 — The external slot takes the highest-value vertical.**
`security` when present in the active set, otherwise `bugs`: model diversity should be spent where panel disagreement matters most.

**D8 — No `.claude/agents/*.md` card.**
It is not a Claude subagent. It is documented in the `/ship` command and as a row in `.claude/AGENT_REGISTRY.md` — which already has a **Model** column. Saying so explicitly keeps the CANON-01 declination mapping unambiguous.

**D9 — Deterministic JSON coercion, never regex repair.**
Even with `--output-schema`, output can arrive fenced or with a preamble. Ordered strategies: direct parse → strip fence → brace-balance scan (string- and escape-aware) → `null`. Never a heuristic repair: `null` produces a `coercion-failed` degradation and the slot reverts to Anthropic.

**D10 — Persistence goes through the recorder, not reimplemented.**
`scripts/record-agent-return.mjs` owns schema validation, M12 citation resolution and provenance stamping. A recorder exit 1 (schema or unresolvable citation) is an `envelope-rejected` degradation and the slot reverts to Anthropic. External models will fail M12 more often than subagents: that is **correct**. Raw stdout must **never** be persisted into evidence (PII scan, `check-no-redacted-tokens`): only the validated envelope is.

## Open questions

- What prompt maximises the yield of an external reviewer that has not read AGENTS.md? Should an invariant excerpt be inlined, or do we accept that the external reviewer mainly brings fresh eyes on bugs and security?
- When the external model fails M12 (unresolvable citation), should the finding really be lost? An alternative is demoting it to `info` the way M13 does with refuted findings, rather than discarding it.
- Is `origin/main...HEAD` the right review base, or should the merge contract's base be used?

---

## Acceptance Criteria

- [ ] AC-1: `planCrossModelSlots` is pure and guarantees `external.length + anthropic === totalSlots` for **every** tier × availability combination — asserted in tests.
- [ ] AC-2: if the provider is unavailable, unauthenticated, or consent is missing, the slot **reverts to Anthropic** and the panel keeps its expected size.
- [ ] AC-3: `schemas/agent-return-external.schema.json` exists as the reduced projection (`verdict`, `confidence`, `findings[]`, `refutations[]`) and is passed to `--output-schema`.
- [ ] AC-4: invocation goes through `runCli` with a scratch-only Codex profile extending `:read-only`, denying the host filesystem root, permitting scratch reads, disabling network, `retries: 0`, an explicit `timeoutMs`, and prompt+diff on **stdin** (never argv) — asserted on the exact argv/options object.
- [ ] AC-5: the diff is truncated at 512 KB with an explicit marker, and truncation produces a dedicated degradation reason.
- [ ] AC-6: `extractAgentReturnJson` handles, with table tests: bare JSON, fenced, prose→JSON, JSON→prose, two objects (last wins), braces inside strings, truncated ⇒ `null`, empty ⇒ `null`.
- [ ] AC-7: persistence goes through `scripts/record-agent-return.mjs` with the provenance flags; raw stdout is never written under `.arbiter/evidence/`.
- [ ] AC-8: `ShipStep.externalReviewers` is additive and optional; `reviewAgents` values per tier stay **byte-identical** to today (INV-50).
- [ ] AC-9: `.claude/commands/ship.md` documents the external slot and includes `codex-reviewer` in the `agents-dispatched.json` example; `.claude/AGENT_REGISTRY.md` gains the matching row.
- [ ] AC-10: subprocess-boundary tests run **without Codex installed**, via a `runCli` mock and an executable stub at the head of `PATH`.
- [ ] AC-11: `node scripts/check-all.mjs L2` green, `check-anti-telemetry` and `check-no-direct-spawn` included.

## Non-Goals

- No degradation artifact, no new gate, no `model_diversity` axis in the dispatch matrix: those are #2358.
- No slot on the M13 skeptics in this v1 (declared as a follow-on; `slots.redTeamReview` stays 0).
- No adapter other than `codex`.
- No change to existing panel counts or to tier selection logic.

## Files / contracts touched

- `src/integrations/external-review.ts` — new: pure planner + invoker + coercion
- `schemas/agent-return-external.schema.json` — new, reduced projection
- `src/commands/task-ship.ts` — additive `ShipStep.externalReviewers`; `reviewAgents` unchanged
- `src/commands/ship-profile.ts` — exposes the config on the profile
- `.claude/commands/ship.md` — external-slot section + `agents-dispatched.json` example
- `.claude/AGENT_REGISTRY.md` — `codex-reviewer` row (Model column already present)
- `__tests__/integrations/`, `__tests__/commands/task-ship-*`
- Contract: `arbiter-agent-return-v1` unchanged; `reviewAgents` unchanged; no `.claude/agents/*.md` card

## Wave placement

Lane **D (ship slot)**. Depends on #2354, #2355, #2356. `conflicts-with:#2356` (both touch `src/commands/ship-profile.ts`) and `conflicts-with:#2358` (both touch `src/integrations/external-review.ts`) — serial lane, same worktree.
