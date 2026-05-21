---
'arbiter': major
---

feat(#1002)!: widen GovernanceLevel L1/L2/L3 → L1/L2/L3/L4; move evidence harness to L4-only

**Breaking changes:**

- `GovernanceLevel` widened from `'L1' | 'L2' | 'L3'` to `'L1' | 'L2' | 'L3' | 'L4'`
- Evidence harness (`evidence-retention`, `evidence-backlog`) moved from L2+ to **L4-only**
- STRIDE risk assessment moved from L3 to **L4-only**
- TRACK_ROUTER generation moved from L3 to **L4-only**
- Config `$schemaVersion` bumped 2→3 (forward-only migration applied automatically on next read)
- `src/config/thresholds-l1-l2-l3.ts` renamed to `src/config/thresholds-by-level.ts` (CANON-20)
- L3 now activates E2E + mutation testing only (no evidence/compliance artifacts)
- SLSA `verifyOnSign` in release workflow now requires L4 (was L3)

**New level summary:**

| Level | Activates                                                        |
| ----- | ---------------------------------------------------------------- |
| L1    | lint + format + unit tests                                       |
| L2    | + coverage + integration + debt gates + security scan            |
| L3    | + E2E + mutation testing                                         |
| L4    | + evidence harness + STRIDE risk + TRACK_ROUTER + SLSA-L3 attest |

**Migration guidance:**

- Existing L2 projects: unchanged except evidence harness no longer regenerates (was a misconfiguration)
- Existing L3 projects: unchanged for quality gates; evidence artifacts move to L4 — if you relied on evidence, run `arbiter upgrade-level --to L4`
- All projects: `$schemaVersion` migration is automatic on next `arbiter update` run
