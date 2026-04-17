# ADR-026 — Scaled Thresholds and Practical/Pedantic Strictness Tiers

**Status:** Accepted
**Date:** 2026-04-16
**Issue:** #88 (MG — Scaled Thresholds + Practical/Pedantic Tiers)

---

## Context

Arbiter's generated quality gates apply coverage and mutation thresholds based
on governance level (L2 = 80%, L3 = 85%). This flat-rate approach creates two
problems:

1. **Small projects are penalised.** A 200-line CLI tool cannot reach 80%
   coverage on a meaningful test suite without padding tests — the threshold
   forces overhead before value is established.

2. **Large projects get off easy.** A 50k-line monolith at exactly 80% is
   coasting; the same threshold should ramp upward as the project matures.

Additionally, teams vary in how aggressively they want static analysis
enforced. Some teams want `noUncheckedIndexedAccess` in TypeScript; others
consider it too noisy. There was no mechanism to express this preference.

---

## Decision

### Threshold profiles

Two profiles control how coverage/mutation thresholds are computed:

| Profile  | Behaviour                                                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `fixed`  | Flat 80% (L2) / 85% (L3). Default. Equivalent to previous behaviour.                                                                     |
| `scaled` | LoC-based ramp. Coverage disabled < 1 000 LoC. Mutation disabled < 5 000 LoC. Coverage threshold ramps 60% → 85% between 1k and 10k LoC. |

The computation is centralised in `src/config/thresholds.ts::computeThresholds()`,
which takes `(linesOfCode, profile, governanceLevel)` and returns a
`ThresholdSet`. All generators that produce quality-gate scripts call this
function and pass the computed values to templates as pre-computed data.
Templates no longer compute thresholds inline.

### Strictness tiers

Two tiers control the aggressiveness of static analysis rules:

| Tier        | Behaviour                                                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `practical` | Standard rules. Suitable for most teams. Max complexity 15.                                                                                           |
| `pedantic`  | Additional rules layered on top: `noUncheckedIndexedAccess` (TS), `clippy::pedantic` (Rust), max complexity 10, extra Checkstyle/golangci/ruff rules. |

The rule sets are defined in `src/config/strictness-tiers.ts::getStrictnessTierRules()`.
Both the `ProjectConfig` and the persisted `arbiter.json` carry the chosen tier.

---

## Consequences

**Positive:**

- Small projects (<1k LoC) are no longer penalised with a 80% coverage gate
  they cannot meaningfully reach.
- Large projects ramp toward 85%, incentivising continuous improvement.
- Teams opt into pedantic analysis explicitly; `practical` is not watered down.
- Threshold logic is isolated in a pure function — easy to test, easy to reason about.

**Negative:**

- `fixed` is the default; teams must opt into `scaled` explicitly. If they do
  not, the ramp benefit does not apply. This is intentional — changing thresholds
  on existing projects without opt-in would break existing gates.
- LoC detection at `arbiter init` time is approximate (it counts source files
  in the target directory). Post-init threshold decisions may differ from
  detected values.

---

## Implementation notes

- `src/config/thresholds.ts` — pure computation, no I/O.
- `src/config/strictness-tiers.ts` — pure rule-set lookup, no I/O.
- `ProjectConfig` fields: `thresholdProfile`, `strictnessTier`, `linesOfCode`.
- `ArbiterConfig` persists `thresholdProfile` and `strictnessTier` for `arbiter update` idempotency.
- ADR-024 (suppression expiry) is unrelated; ADR-025 covers claim-verified governance docs.
