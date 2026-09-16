# #2414 — product audit and finding loop

Base: `a75d246f989fc64373b4920fb2f6b5e8b894d806`

## Deliverables

1. Extend the existing FEATURE_MATRIX checker with an opt-in `product-complete` report contract: exact subject SHA, fixed denominator, known capability IDs, complete entrypoint/owner/config/proof/overlap cells, separate readiness/docs/behavior verdicts, and honest coverage states.
2. Restore finding add/list/triage/promote handlers over the existing `.arbiter/findings/*.jsonl` spool. Reuse `task-note`, the prior promotion implementation, the graph snapshot, and the GitHub issue helper; add no store or dashboard.
3. Prove one four-gap journey: missing docs, absent emitted control, unproved behavior, and unavailable manual attestation remain distinct; promotion is loss-free and fingerprint-deduplicated.

## Verification

- BAD/CLEAN product-report fixtures fail/pass the same source and emitted checker.
- Focused command tests cover malformed input, deterministic triage, duplicate promotion, and unchanged spool bytes.
- Targeted build/tests, generated-example parity, one final independent exact-SHA review, then one L2/CI run and merge.

## Boundaries

- FEATURE_MATRIX remains the capability authority.
- `.arbiter/findings` remains the finding store.
- Dependency graph input remains external; the existing graph snapshot is only a revalidation signal.
- Public command renaming/removal remains in #2706; this issue supplies working handlers, not aliases or placeholder routes.
