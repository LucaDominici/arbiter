# Contract Integrity 5-Gate Suite (M-08) — Port Notes

**Date:** 2026-05-18
**Origin:** #716 — "M-08 — Contract Integrity 5-gate suite (distinct from Pact)"

## What landed in this PR

`src/templates/governance/contract-integrity-policy.md.ejs` — the **policy template** for the 5-gate suite. Documents what each gate does, the configuration surface, the recommended adoption order, the distinction from Pact (M28), and what each gate explicitly does NOT do.

## What did NOT land

The 5 gate scripts + the `src/generators/contract-integrity.ts` generator that wires them. Each gate is mechanical and per-stack (TS / Java / Go produce different schema-diff outputs); shipping all 5 scripts × 3 stacks + the generator + per-stack render tests would be a ~10–15h PR. The policy template ships first so the surface and opt-in flags are public; the gate scripts come in follow-up PRs.

## The 5 gates

| Gate | Purpose                                                  | Adoption position |
| ---- | -------------------------------------------------------- | ----------------- |
| A    | OpenAPI snapshot — detect non-additive surface changes   | adopt first       |
| D    | Dead code — endpoints declared but unreached, vice versa | adopt second      |
| E    | Test hygiene — every endpoint has ≥1 test                | adopt third       |
| B    | DTO parity — server / client type equivalence            | adopt fourth      |
| C    | Operation smoke — 404/422/5xx response shape             | adopt last        |

Order rationale documented in the template itself: cheapest signal first, requires-server last.

## Configuration surface

```jsonc
{
  "contract_integrity": {
    "gates": {
      "openapi_snapshot": true,
      "dto_parity": true,
      "operation_smoke": true,
      "dead_code": true,
      "test_hygiene": true,
    },
    "snapshot_path": "tests/fixtures/openapi-baseline.yaml",
    "smoke_probe_timeout_ms": 5000,
  },
}
```

All gates default to `false`. Per-gate opt-in.

## Distinct from Pact (M28)

| Property    | M-08 Contract Integrity | M28 Pact                       |
| ----------- | ----------------------- | ------------------------------ |
| Direction   | producer asserts        | consumer dictates              |
| Catches     | surface drift           | semantic / handler-logic drift |
| Run trigger | every PR                | consumer-first, then broker    |

Both are recommended for L3 surfaces — they catch different failure modes.

## CANON references

- **CANON-04** (every .ejs has a render test): satisfied — `__tests__/templates/governance-render.test.ts` asserts no EJS leaks, projectName, all 5 gate sections, Pact-distinction, all 5 opt-in flag names, adoption-order recommendation.

## Follow-up issues (NOT opened tonight)

The following items are not yet tracked as separate issues but should be opened before the gate scripts can be reviewed:

1. Gate A implementation (per-stack OpenAPI snapshot + diff)
2. Gate B implementation (per-stack DTO parity)
3. Gate C implementation (operation smoke + structured-error response shape)
4. Gate D implementation (dead-endpoint + undeclared-handler detection)
5. Gate E implementation (test-presence-per-endpoint assertion)
6. `src/generators/contract-integrity.ts` (wire the per-stack scripts into the generated project's check-all.mjs at L3)

Each follow-up requires per-stack templates + render tests + generator unit test (CANON-04, CANON-05, CANON-11) + matrix fixture (INV-32) for every proven language cell.

## What this port intentionally excludes

- **Semantic-contract verification** — that's Pact's job, not M-08's.
- **Runtime type-mismatch detection at client boundary** — separate concern, not gated by M-08.
- **Test-quality assessment beyond presence** — pair with mutation testing (M22) for quality signal.

## Source

#716 (M-08). Reference-impl source: `docs/FRAMEWORK/CONTRACT_INTEGRITY/*` (6 specs).
