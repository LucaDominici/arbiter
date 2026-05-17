# Verification Bridge (M-07) — Audit Decision

**Date:** 2026-05-17
**Origin:** #715 — "M-07 — Plan Verification Bridge (PLAN.json v2 + Context Pack + Reuse Registry)"
**Decision required by:** #727 (Audit-as-Code), which depends on this audit

## Source

`reference-impl/docs/FRAMEWORK/VERIFICATION_BRIDGE/*` — 10 specs plus `docs/METHOD/VERIFICATION_BRIDGE.md`.

Components advertised by the reference implementation:

| Component                                          | Reference-impl status | arbiter status                                                          |
| -------------------------------------------------- | --------------------- | ----------------------------------------------------------------------- |
| PLAN.json schema (v1, v2)                          | v2                    | **v1 implemented** — see `src/verify/run.ts`, ADR-039                   |
| `arbiter verify plan` CLI                          | exists                | **implemented** — exit 0 / 2 contract per ADR-039                       |
| Rule registry + Zod validation                     | exists                | **implemented** — applicability-gated rules with plugin hook            |
| REVIEW.json artifact (pointer + immutable archive) | exists                | **implemented** — `.arbiter/plan/runs/<runId>/REVIEW.json`              |
| 3-round auto-verification loop                     | exists                | **not implemented** — intentionally out of scope (see Decision)         |
| HARD / SOFT verdict promotion                      | exists                | **partial** — `fail_on_warn` flag exists; HARD/SOFT label does not      |
| Context Pack (deterministic context slicing)       | exists                | **implemented** — `src/context-pack/generator.ts` + `review-context.ts` |
| Reuse Registry (canonical-symbol search)           | exists                | **not implemented** — canonical registry surface absent                 |

## Decision

**Cherry-pick. Do NOT absorb the full reference-impl bridge.**

Absorbed (already on main, no further work needed):

- ✅ PLAN.json v1 + verify CLI + rule registry + REVIEW.json artifact (ADR-039, M-07 scope satisfied for the core contract)
- ✅ Context Pack (deterministic context slicing) — already implemented under `src/context-pack/`

Deferred (not absorbed):

- ⏭️ **3-round auto-verification loop** — arbiter's plan-anchor hook + plan-review subagents already serve the same purpose with human-in-the-loop semantics. The 3-round loop's value is in fully-autonomous agents; arbiter's design point is supervised agents where the human reviews each round. Adopting the 3-round loop would duplicate existing hooks and obscure the human-review boundary. Revisit if a fully-autonomous agent surface is ever added.
- ⏭️ **HARD/SOFT verdict promotion as named labels** — `fail_on_warn` already covers the promotion semantic; the named-label surface adds vocabulary without behavioural change. Re-evaluate only if a downstream consumer asks.

New scope opened by this audit (separate follow-up issues, not this PR):

- 📋 **Reuse Registry** — canonical-symbol search to prefer extension over duplication. This is a real gap (the closest thing arbiter has is the CANON-16 prose rule "Refactor-first before creating new source files"). A registry surface would mechanise that rule. **Not opened tonight** — needs design pass; track as a new issue if/when prioritised.

## CANON-16 cross-reference

CANON-16 (Refactor-first) already cites a survey requirement. A Reuse Registry would be the machine-check that promotes CANON-16 to enforcement. The reference-impl team built a registry; arbiter has documented the rule. Promoting CANON-16 → INV-NN with a registry would be the natural next step. Tracked here as a known follow-up, **not opened as an issue tonight** — the design of the canonical-symbol search needs a separate audit pass (which symbols are "canonical"? how is staleness detected? what is the index format?).

## Opt-in flag

The audit confirms `governance.verification_bridge` (per issue) is satisfied by the existing arbiter implementation. No new flag is needed — the existing `review_bridge.enabled` config field already gates the bridge:

```jsonc
{
  "review_bridge": { "enabled": true },
}
```

The `false` setting short-circuits all evaluation and emits SKIPPED, allowing incremental adoption.

## Resolution

#715 closes as **AUDIT-COMPLETE / NO-ABSORB**:

- The core M-07 mechanism (PLAN.json + verify CLI + REVIEW.json) is already in arbiter (ADR-039).
- Context Pack is already implemented.
- The 3-round loop and HARD/SOFT labels are intentionally deferred (see Decision rationale).
- Reuse Registry is a real gap but needs a separate design pass; tracked here, not opened as an issue tonight.

This unblocks #727 (Audit-as-Code), which was sequenced after #715 in the META plan.

## See also

- ADR-039 — V1 Verification Bridge (existing)
- CANON-16 — Refactor-first before creating new source files
- `src/verify/run.ts` — verify plan implementation
- `src/context-pack/` — Context Pack implementation
